/**
 * Shared API response types — mirrors the backend Prisma enums and
 * the JSON shapes returned by the /api endpoints.
 */

export type Role = 'ADMIN' | 'STAFF';
export type CaseStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type CasePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SampleStatus = 'RECEIVED' | 'IN_PROCESS' | 'IN_REVIEW' | 'COMPLETED' | 'REJECTED';
export type SampleType = 'BLOOD' | 'SWAB' | 'TISSUE' | 'URINE' | 'FECAL' | 'MILK' | 'OTHER';
export type ResultStatus = 'NOT_AVAILABLE' | 'PENDING' | 'RELEASED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type ImportStatus = 'PREVIEWED' | 'COMMITTED' | 'COMMIT_FAILED' | 'FAILED';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface UserRef {
  id: string;
  name: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt?: string;
}

export interface CaseListItem {
  id: string;
  caseNumber: string;
  title: string;
  species: string;
  breed?: string | null;
  ageMonths?: number | null;
  ownerRef: string;
  concern: string;
  priority: CasePriority;
  status: CaseStatus;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  assignedTo?: UserRef | null;
}

export interface SampleRef {
  id: string;
  sampleCode: string;
  sampleType: SampleType;
  status: SampleStatus;
  collectionDate: string;
  resultStatus: ResultStatus;
}

export interface CaseDetailRecord extends CaseListItem {
  assignedTo?: (UserRef & { email: string }) | null;
  samples: SampleRef[];
  tasks: TaskRecord[];
}

export interface AuditEventRecord {
  id: string;
  actorId: string;
  actorName: string;
  eventType: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  summary: string;
  meta?: unknown;
  createdAt: string;
}

export interface SampleRecord {
  id: string;
  sampleCode: string;
  caseId: string;
  case?: { id: string; caseNumber: string; title: string; species: string; priority?: CasePriority; status?: CaseStatus };
  sampleType: SampleType;
  status: SampleStatus;
  collectionDate: string;
  receivedAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  labLocation: string;
  resultStatus: ResultStatus;
  resultSummary: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: TaskRecord[];
}

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  completedAt: string | null;
  createdAt: string;
  assignee?: UserRef | null;
  case?: { id: string; caseNumber: string; title: string } | null;
  sample?: { id: string; sampleCode: string } | null;
  isOverdue?: boolean;
}

export interface ImportBatchSummary {
  id: string;
  fileName: string;
  status: ImportStatus;
  createdAt: string;
  committedAt: string | null;
  counts: { total: number; valid: number; rejected: number; duplicates: number; inserted: number };
  createdByName?: string;
}

export interface RowError {
  field: string;
  code: string;
  message: string;
}

export interface ReportRow {
  row: number;
  sampleCode: string;
  caseNumber: string;
  outcome: 'VALID' | 'REJECTED' | 'DUPLICATE';
  errors: RowError[];
  data: Record<string, string>;
}

export interface ValidationReport {
  fileName: string;
  summary: { totalRows: number; valid: number; rejected: number; duplicates: number };
  rows: ReportRow[];
}

export interface DashboardSummary {
  cases: { total: number; byStatus: Record<CaseStatus, number> };
  samples: { total: number; byStatus: Record<SampleStatus, number>; awaitingProcessing: number; invalidMetadata: number };
  avgTurnaroundHours: number | null;
  completedSamplesWithTurnaround: number;
  caseVolume: { day: string; count: number }[];
  workload: { id: string; name: string; role: Role; openTasks: number; openCases: number; activeSamples: number }[];
  dueSoonTasks: {
    id: string;
    title: string;
    dueDate: string;
    status: TaskStatus;
    priorityRank: number;
    assignee: string | null;
    caseNumber: string | null;
  }[];
  recentActivity: {
    id: string;
    eventType: string;
    targetType: string;
    targetLabel: string;
    summary: string;
    actorName: string;
    createdAt: string;
  }[];
  openTasks: number;
}
