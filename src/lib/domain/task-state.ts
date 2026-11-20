/** Mirrors public.task_transition_allowed() in SQL. The DB trigger is authoritative. */
export const TASK_STATUSES = ['draft', 'submitted', 'pending_approval', 'approved', 'in_progress', 'blocked',
  'under_review', 'completed', 'rejected', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', pending_approval: 'Pending approval', approved: 'Approved',
  in_progress: 'In progress', blocked: 'Blocked', under_review: 'Under review', completed: 'Completed',
  rejected: 'Rejected', cancelled: 'Cancelled',
};

const NEXT: Record<TaskStatus, readonly TaskStatus[]> = {
  draft: ['submitted', 'pending_approval', 'cancelled'],
  submitted: ['pending_approval', 'approved', 'rejected', 'draft', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'draft', 'cancelled'],
  approved: ['in_progress', 'blocked', 'under_review', 'completed', 'cancelled'],
  in_progress: ['blocked', 'under_review', 'completed', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  under_review: ['in_progress', 'completed'],
  completed: ['in_progress'],
  rejected: ['draft'],
  cancelled: [],
};

export const canTransition = (from: TaskStatus, to: TaskStatus) => NEXT[from].includes(to);

export interface TransitionContext {
  isManager: boolean; isLeader: boolean; isCreator: boolean; hasOpenBlockers: boolean; requireCompletionReview: boolean;
}

/** Transitions a user may trigger directly from the UI (approvals/blocking go through dedicated actions). */
export function userTransitions(from: TaskStatus, ctx: TransitionContext): TaskStatus[] {
  return NEXT[from].filter((to) => {
    if (to === 'approved' || to === 'rejected' || to === 'blocked') return false;
    if (from === 'blocked' && ctx.hasOpenBlockers) return false;
    if (from === 'completed' && !ctx.isLeader) return false;
    if (to === 'cancelled' && !(ctx.isCreator || ctx.isLeader)) return false;
    if (to === 'completed' && ctx.requireCompletionReview && !ctx.isLeader) return false;
    return true;
  });
}

export const isTerminal = (s: TaskStatus) => s === 'completed' || s === 'cancelled' || s === 'rejected';
export const isCommitted = (s: TaskStatus) => ['approved', 'in_progress', 'blocked', 'under_review', 'completed'].includes(s);
export const isActive = (s: TaskStatus) => ['approved', 'in_progress', 'blocked', 'under_review'].includes(s);
