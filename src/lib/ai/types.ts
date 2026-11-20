export interface EstimateInput {
  title: string; description: string; category: string | null; expectedDeliverable: string | null;
  employeeEstimateHours: number | null; startDate: string | null; deadline: string | null;
  dependencies: string[]; workingHoursPerDay: number;
  workload: { openTasks: number; remainingHours: number; capacityHours: number } | null;
  history: { sampleSize: number; avgActualToEstimate: number | null };
  recentUnplannedHours: number; openBlockers: number;
}
export interface EstimateResult {
  recommendedMinHours: number; recommendedMaxHours: number;
  verdict: 'reasonable' | 'too_low' | 'too_high' | 'insufficient_info';
  explanation: string; missingInformation: string[]; usedCompanyHistory: boolean;
  source: 'ai' | 'heuristic'; provider?: string; model?: string;
}
export interface ExtensionInput {
  taskTitle: string; originalDeadline: string | null; currentDeadline: string; requestedDeadline: string; reason: string;
  estimatedHours: number | null; actualHours: number; progress: number; workingHoursPerDay: number;
  workingDaysRequested: number; openBlockers: Array<{ description: string; external: boolean }>;
  unplannedWorkDuringPeriod: Array<{ title: string; hours: number; urgent: boolean }>;
  previousExtensions: number;
}
export interface ExtensionResult {
  verdict: 'reasonable' | 'questionable' | 'insufficient_info';
  recommendation: string; factors: string[]; usedCompanyHistory: boolean;
  source: 'ai' | 'heuristic'; provider?: string; model?: string;
}
