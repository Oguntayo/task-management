import { z } from 'zod';

const uuid = z.string().uuid();
const optionalText = z.string().trim().max(5000).optional().or(z.literal('').transform(() => undefined));
const dateTime = z.string().min(1, 'Required').refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
});
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
export const companySchema = z.object({
  name: z.string().trim().min(2, 'Company name is too short').max(120),
  industry: optionalText, timezone: z.string().min(1).default('UTC'),
});

export const taskSchema = z.object({
  title: z.string().trim().min(3, 'Give the task a clear title').max(200),
  description: z.string().trim().min(10, 'Describe the work (at least a sentence)').max(10000),
  categoryId: uuid.optional().or(z.literal('').transform(() => undefined)),
  departmentId: uuid.optional().or(z.literal('').transform(() => undefined)),
  projectId: uuid.optional().or(z.literal('').transform(() => undefined)),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  planningPeriod: z.enum(['daily', 'weekly', 'custom']).default('weekly'),
  periodStart: z.string().optional().or(z.literal('').transform(() => undefined)),
  periodEnd: z.string().optional().or(z.literal('').transform(() => undefined)),
  expectedStartDate: z.string().optional().or(z.literal('').transform(() => undefined)),
  deadline: dateTime,
  estimatedHours: z.coerce.number().positive('Enter hours').max(2000),
  expectedDeliverable: z.string().trim().max(1000).optional().or(z.literal('').transform(() => undefined)),
  complexity: z.coerce.number().int().min(1).max(5).optional(),
  assigneeIds: z.array(uuid).max(20).default([]),
  dependencyIds: z.array(uuid).max(20).default([]),
  submit: z.boolean().default(true),
});
export type TaskInput = z.infer<typeof taskSchema>;

export const unplannedSchema = z.object({
  title: z.string().trim().min(3, 'Give it a short title').max(200),
  whatHappened: z.string().trim().min(5, 'Describe what happened').max(5000),
  actionTaken: z.string().trim().min(3, 'Describe what you did').max(5000),
  whyNecessary: z.string().trim().min(3, 'Explain why it was necessary').max(5000),
  requestedByName: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  requestedByUserId: uuid.optional().or(z.literal('').transform(() => undefined)),
  occurredAt: dateTime,
  hoursSpent: z.coerce.number().min(0).max(168),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  isUrgent: z.boolean().default(false),
  incidentReference: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  workStatus: z.enum(['completed', 'in_progress', 'awaiting_action']),
  projectId: uuid.optional().or(z.literal('').transform(() => undefined)),
  relatedTaskId: uuid.optional().or(z.literal('').transform(() => undefined)),
  categoryId: uuid.optional().or(z.literal('').transform(() => undefined)),
  attachments: z.array(z.object({ publicId: z.string(), url: z.string().url(), resourceType: z.string(), format: z.string().optional(), bytes: z.number().optional(), name: z.string().optional() })).max(10).default([]),
});
export type UnplannedInput = z.infer<typeof unplannedSchema>;

export const blockerSchema = z.object({
  taskId: uuid,
  category: z.enum(['waiting_for_employee', 'api_credentials', 'management_approval', 'external_outage', 'missing_information', 'technical_dependency', 'customer_delay', 'other']),
  description: z.string().trim().min(5, 'Describe what is blocking you').max(3000),
  isExternal: z.boolean().default(false),
  responsibleUserId: uuid.optional().or(z.literal('').transform(() => undefined)),
  responsibleDepartmentId: uuid.optional().or(z.literal('').transform(() => undefined)),
  expectedResolutionDate: z.string().optional().or(z.literal('').transform(() => undefined)),
});
export const extensionSchema = z.object({
  taskId: uuid, requestedDeadline: dateTime, reason: z.string().trim().min(5, 'Explain why you need more time').max(3000),
});
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roles: z.array(z.enum(['admin', 'pm', 'tech_lead', 'employee'])).min(1),
  departmentId: uuid.optional().or(z.literal('').transform(() => undefined)),
  jobTitle: z.string().trim().max(80).optional().or(z.literal('').transform(() => undefined)),
});
export const progressSchema = z.object({
  taskId: uuid, progress: z.coerce.number().int().min(0).max(100),
  hours: z.coerce.number().min(0).max(24).optional(), note: z.string().trim().max(1000).optional(),
});
export const companySettingsSchema = z.object({
  name: z.string().trim().min(2).max(120), industry: optionalText, timezone: z.string().min(1),
  reminderOffsetsHours: z.array(z.coerce.number().int().min(1).max(336)).max(5),
  remindOnDeadline: z.boolean(), remindOverdue: z.boolean(),
  overdueNotifyRoles: z.array(z.enum(['pm', 'admin', 'tech_lead'])),
  requireCompletionReview: z.boolean(), workingHoursPerDay: z.coerce.number().min(1).max(24),
  allowSelfApproval: z.boolean().default(false),
  retentionDays: z.coerce.number().int().min(30).max(3650).optional().or(z.literal('').transform(() => undefined)),
});

export function flattenErrors(e: z.ZodError): Record<string, string[]> {
  return e.flatten().fieldErrors as Record<string, string[]>;
}
