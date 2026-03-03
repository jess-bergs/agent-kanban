/**
 * External PR Scanner
 *
 * Periodically scans registered projects for external PRs (dependabot, human contributors)
 * and creates tickets for them so they flow through the auditor + auto-merge pipeline.
 */
import { execSync } from 'node:child_process';
import { listProjects, listTickets, createTicket, updateTicket, getProjectsPayload } from './store.ts';
import { addToWatchlist } from './auditor.ts';
import type { Project, Ticket, WSEvent } from '../src/types.ts';

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

let scanTimer: ReturnType<typeof setInterval> | null = null;
let broadcastFn: (event: WSEvent) => void = () => {};

interface GhPrEntry {
  number: number;
  url: string;
  title: string;
  author: { login: string };
  headRefName: string;
}

/** Parse "owner/repo" from a GitHub remote URL (HTTPS or SSH). */
function parseOwnerRepo(remoteUrl: string): string | null {
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/.]+)/);
  const sshMatch = remoteUrl.match(/github\.com:([^/]+\/[^/.]+)/);
  const repo = (httpsMatch?.[1] || sshMatch?.[1])?.replace(/\.git$/, '');
  return repo || null;
}

/** Check if an author matches the project's policy filter. */
function authorMatches(
  login: string,
  filter: 'all' | 'dependabot' | string[],
): boolean {
  if (filter === 'all') return true;
  if (filter === 'dependabot') {
    return login === 'dependabot[bot]' || login === 'dependabot';
  }
  return filter.includes(login);
}

/** Run a single scan tick for one project. */
async function scanProject(
  project: Project,
  existingTickets: Ticket[],
): Promise<Ticket[]> {
  if (!project.externalPrPolicy?.enabled || !project.remoteUrl) return [];

  const ownerRepo = parseOwnerRepo(project.remoteUrl);
  if (!ownerRepo) {
    console.log(`[ext-pr] Cannot parse owner/repo from ${project.remoteUrl}`);
    return [];
  }

  const policy = project.externalPrPolicy;
  let prs: GhPrEntry[];

  try {
    const raw = execSync(
      `gh pr list --repo ${ownerRepo} --state open --json number,url,title,author,headRefName --limit 50`,
      { encoding: 'utf-8', timeout: 30000 },
    );
    prs = JSON.parse(raw) as GhPrEntry[];
  } catch (err) {
    console.error(`[ext-pr] Failed to list PRs for ${ownerRepo}:`, err);
    return [];
  }

  const created: Ticket[] = [];

  for (const pr of prs) {
    // Skip dispatcher-created branches
    if (/^agent[/-]ticket-/i.test(pr.headRefName)) continue;

    // Skip authors that don't match the policy
    if (!authorMatches(pr.author.login, policy.authors)) continue;

    // Skip if a ticket already references this PR URL
    if (existingTickets.some(t => t.prUrl === pr.url)) continue;

    // Skip if already on auditor watchlist (addToWatchlist handles dedup)
    // We'll add to watchlist below — just check ticket existence here.

    console.log(`[ext-pr] Importing PR #${pr.number} from ${pr.author.login}: ${pr.title}`);

    const ticket = await createTicket({
      projectId: project.id,
      subject: pr.title,
      instructions: `External PR #${pr.number} by ${pr.author.login}.\n\nReview and merge via the auditor pipeline.`,
      yolo: policy.yolo,
      autoMerge: policy.autoMerge,
    });

    // Stamp the external-PR-specific fields
    const updated = await updateTicket(ticket.id, {
      status: 'in_review',
      prUrl: pr.url,
      prNumber: pr.number,
      source: 'external_pr_scan',
      prAuthor: pr.author.login,
    }, 'external_pr_scan');

    if (updated) {
      broadcastFn({ type: 'ticket_updated', data: updated });
      created.push(updated);

      // Add to auditor watchlist — triggers initial review
      addToWatchlist(pr.url, updated.id).catch(err => {
        console.error(`[ext-pr] Failed to add PR #${pr.number} to watchlist:`, err);
      });
    }
  }

  return created;
}

/** Run a full scan tick across all enabled projects. */
export async function externalPrScanTick(): Promise<Ticket[]> {
  const projects = await listProjects();
  const tickets = await listTickets();
  const allCreated: Ticket[] = [];

  for (const project of projects) {
    if (!project.externalPrPolicy?.enabled) continue;
    const created = await scanProject(project, tickets);
    allCreated.push(...created);
    // Add newly created tickets to the existing list so subsequent projects
    // don't create duplicates for the same PR URL
    tickets.push(...created);
  }

  if (allCreated.length > 0) {
    console.log(`[ext-pr] Imported ${allCreated.length} external PR(s)`);
    broadcastFn({ type: 'projects_updated', data: await getProjectsPayload() });
  }

  return allCreated;
}

/** Start the periodic scanner. */
export function startExternalPrScanner() {
  if (scanTimer) return;
  console.log('[ext-pr] External PR scanner started (24h interval)');
  // Run first tick after a short delay to let the server finish startup
  setTimeout(() => {
    externalPrScanTick().catch(err => {
      console.error('[ext-pr] Scan tick failed:', err);
    });
  }, 10_000);
  scanTimer = setInterval(() => {
    externalPrScanTick().catch(err => {
      console.error('[ext-pr] Scan tick failed:', err);
    });
  }, SCAN_INTERVAL_MS);
}

/** Stop the periodic scanner. */
export function stopExternalPrScanner() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
    console.log('[ext-pr] External PR scanner stopped');
  }
}

/** Set the broadcast function for WebSocket events. */
export function setExternalPrScannerBroadcast(fn: (event: WSEvent) => void) {
  broadcastFn = fn;
}
