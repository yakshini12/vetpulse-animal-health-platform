/**
 * Development seed: deterministic synthetic data. NEVER use real patient,
 * animal-owner or production data here. Safe to re-run: it clears and
 * recreates every table.
 */
import bcrypt from 'bcryptjs';
import { CasePriority, CaseStatus, ResultStatus, SampleStatus, SampleType, TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from '../src/db.js';

const PRIORITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const TASK_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261029);
const pick = <T>(items: readonly T[]): T => {
  const value = items[Math.floor(rand() * items.length)];
  return value as T; // index is bounded by construction
};
const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const SPECIES = ['Cattle', 'Buffalo', 'Sheep', 'Goat', 'Poultry', 'Companion animal'];
const BREEDS: Record<string, string[]> = {
  Cattle: ['Gir', 'Sahiwal', 'Holstein Friesian cross'],
  Buffalo: ['Murrah', 'Surti'],
  Sheep: ['Deccani', 'Nellore'],
  Goat: ['Osmanabadi', 'Jamunapari'],
  Poultry: ['Broiler', 'Layer'],
};
const LABS = ['Zone-1 diagnostics lab', 'Zone-2 diagnostics lab', 'Central reference lab', 'Field collection hub A'];
const ORGS = Array.from({ length: 14 }, (_, index) => `ORG-${String(101 + index)}`);
const CONCERNS = [
  'Reduced milk yield reported across the herd',
  'Sudden mortality in a poultry unit',
  'Recurrent respiratory signs in calves',
  'Poor flock growth rate',
  'Suspected nutritional deficiency',
  'Routine herd health screening',
  'Unexplained drop in feed intake',
  'Skin lesions observed during inspection',
];
const SAMPLE_TYPES: SampleType[] = ['BLOOD', 'SWAB', 'TISSUE', 'URINE', 'FECAL', 'MILK', 'OTHER'];
const TASK_TITLES = [
  'Call the organisation contact about the pending sample',
  'Re-run the metadata check on the latest import',
  'Prepare the weekly throughput summary',
  'Verify the outgoing result documents',
  'Restock sample collection kits',
  'Follow up on overdue field collection',
  'Review rejected samples with the lab supervisor',
  'Cross-check case country teams after merge',
];
const STAFF = [
  { name: 'Priya Sharma', email: 'priya.sharma@vetpulse.dev' },
  { name: 'Rahul Verma', email: 'rahul.verma@vetpulse.dev' },
  { name: 'Elena Fischer', email: 'elena.fischer@vetpulse.dev' },
];

async function main(): Promise<void> {
  await prisma.auditEvent.deleteMany({});
  await prisma.importBatch.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.sample.deleteMany({});
  await prisma.animalCase.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await bcrypt.hash('VetPulse!2026', 10);
  const admin = await prisma.user.create({
    data: { email: 'admin@vetpulse.dev', name: 'Anika Rao (Admin)', role: 'ADMIN', passwordHash },
  });
  const staffUsers = [];
  for (const staff of STAFF) {
    staffUsers.push(
      await prisma.user.create({
        data: { email: staff.email, name: staff.name, role: 'STAFF', passwordHash },
      }),
    );
  }

  const caseYear = new Date().getUTCFullYear();
  const cases = [];
  for (let index = 1; index <= 24; index += 1) {
    const species = pick(SPECIES);
    const priority = pick(Object.values(CasePriority));
    const statusRoll = rand();
    const status: CaseStatus =
      statusRoll < 0.45 ? 'IN_PROGRESS' : statusRoll < 0.65 ? 'OPEN' : statusRoll < 0.85 ? 'RESOLVED' : 'CLOSED';
    const createdAt = daysAgo(Math.round(rand() * 44) + 1);
    const caseNumber = `CASE-${caseYear}-${String(index).padStart(4, '0')}`;
    const assignedTo = pick([null, ...staffUsers, ...staffUsers]);
    const record = await prisma.animalCase.create({
      data: {
        caseNumber,
        title: `${species} health inquiry ${index}`,
        species,
        status,
        assignedToId: assignedTo?.id ?? null,
        breed: BREEDS[species] ? pick(BREEDS[species]) : null,
        ageMonths: Math.round(rand() * 80),
        ownerRef: pick(ORGS),
        concern: pick(CONCERNS),
        priority,
        priorityRank: PRIORITY_RANK[priority],
        createdAt,
        updatedAt: createdAt,
        closedAt: status === 'CLOSED' ? daysAgo(Math.round(rand() * 10)) : null,
      },
    });
    cases.push(record);
  }

  const samples = [];
  for (let index = 1; index <= 34; index += 1) {
    const parent = pick(cases);
    const statusPool: SampleStatus[] = index <= 6 ? ['RECEIVED'] : index <= 12 ? ['IN_PROCESS'] : index <= 17 ? ['IN_REVIEW'] : index <= 25 ? ['COMPLETED'] : ['REJECTED', 'IN_REVIEW'];
    const status = pick(statusPool);
    const collectionDate = daysAgo(Math.round(rand() * 30) + 2);
    const receivedAt = collectionDate;
    let processingStartedAt: Date | null = null;
    let completedAt: Date | null = null;
    let rejectedAt: Date | null = null;
    let rejectionReason: string | null = null;
    let resultStatus: ResultStatus = ResultStatus.NOT_AVAILABLE;
    let resultSummary: string | null = null;
    if (status !== 'RECEIVED') {
      processingStartedAt = new Date(receivedAt.getTime() + (rand() * 40 + 6) * 60 * 60 * 1000);
    } else {
      processingStartedAt = null;
    }
    if (status === 'COMPLETED') {
      completedAt = new Date((processingStartedAt ?? receivedAt).getTime() + (rand() * 70 + 6) * 60 * 60 * 1000);
      resultStatus = ResultStatus.RELEASED;
      resultSummary = pick([
        'Reference range check completed; within synthetic tolerance.',
        'Synthetic assay processed; values recorded for the demo only.',
        'Report generated from synthetic values; no diagnostic meaning.',
      ]);
    }
    if (status === 'REJECTED') {
      rejectedAt = new Date((processingStartedAt ?? receivedAt).getTime() + (rand() * 20 + 2) * 60 * 60 * 1000);
      rejectionReason = pick([
        'Sample container damaged in transit.',
        'Insufficient volume for the requested panel.',
        'Label mismatch — collected information incomplete.',
      ]);
    }
    if (status === 'IN_REVIEW') {
      resultStatus = ResultStatus.PENDING;
    }
    const record = await prisma.sample.create({
      data: {
        sampleCode: `SP-${caseYear}-${String(index).padStart(4, '0')}`,
        caseId: parent.id,
        sampleType: pick(SAMPLE_TYPES),
        collectionDate,
        status,
        labLocation: pick(LABS),
        receivedAt,
        processingStartedAt,
        completedAt,
        rejectedAt,
        rejectionReason,
        resultStatus,
        resultSummary,
        createdAt: collectionDate,
        updatedAt: completedAt ?? rejectedAt ?? processingStartedAt ?? collectionDate,
      },
    });
    samples.push(record);
  }

  // Three deliberately inconsistent samples so the "invalid metadata" metric
  // is demonstrable end-to-end (documented quality checks in the README).
  const qualityVictims = cases.slice(0, 3);
  const qualityCase = (index: number): { id: string } => {
    const found = qualityVictims[index];
    if (!found) throw new Error('seed expects at least 3 cases');
    return found;
  };
  await prisma.sample.createMany({
    data: [
      {
        sampleCode: `SP-${caseYear}-9901`,
        caseId: qualityCase(0).id,
        sampleType: pick(SAMPLE_TYPES),
        collectionDate: new Date(Date.now() + 48 * 60 * 60 * 1000), // future collection date
        status: 'RECEIVED',
        receivedAt: new Date(),
        labLocation: pick(LABS),
      },
      {
        sampleCode: `SP-${caseYear}-9902`,
        caseId: qualityCase(1).id,
        sampleType: pick(SAMPLE_TYPES),
        collectionDate: daysAgo(5),
        status: 'COMPLETED',
        receivedAt: daysAgo(5),
        labLocation: pick(LABS),
        // completedAt intentionally missing (rule 3 of the documented quality checks)
      },
      {
        sampleCode: `SP-${caseYear}-9903`,
        caseId: qualityCase(2).id,
        sampleType: pick(SAMPLE_TYPES),
        collectionDate: daysAgo(8),
        status: 'RECEIVED',
        receivedAt: daysAgo(8),
        labLocation: pick(LABS),
        resultStatus: 'RELEASED', // released result on a non-completed sample (rule 5)
        resultSummary: null,
      },
    ],
  });

  for (let index = 0; index < 16; index += 1) {
    const statusRoll = rand();
    const status: TaskStatus = statusRoll < 0.55 ? 'TODO' : statusRoll < 0.8 ? 'IN_PROGRESS' : statusRoll < 0.9 ? 'DONE' : 'CANCELLED';
    const dueRoll = rand();
    const dueDate = dueRoll < 0.25 ? daysAgo(Math.round(rand() * 4) + 1) : dueRoll < 0.55 ? daysAgo(-Math.round(rand() * 3)) : daysAgo(-Math.round(rand() * 12 + 4));
    const priority = pick(Object.values(TaskPriority));
    const parent = pick(cases);
    const sample = rand() < 0.4 ? pick(samples) : null;
    const assignee = status === 'CANCELLED' ? null : pick([...staffUsers, ...staffUsers, admin]);
    await prisma.task.create({
      data: {
        title: pick(TASK_TITLES),
        description: index % 3 === 0 ? 'Synthetic follow-up generated by the seed script.' : null,
        status,
        priority,
        priorityRank: TASK_RANK[priority],
        dueDate,
        completedAt: status === 'DONE' ? daysAgo(Math.round(rand() * 3)) : null,
        caseId: rand() < 0.8 ? parent.id : null,
        sampleId: sample && rand() < 0.8 ? sample.id : null,
        assigneeId: assignee?.id ?? null,
        createdAt: daysAgo(Math.round(rand() * 20) + 1),
      },
    });
  }

  await prisma.auditEvent.createMany({
    data: [
      {
        actorId: admin.id,
        actorName: admin.name,
        eventType: 'SEED_APPLIED',
        targetType: 'USER',
        targetId: admin.id,
        targetLabel: 'development-seed',
        summary: 'Synthetic demo data applied (seed script).',
      },
    ],
  });

  console.log(`Seeded ${staffUsers.length + 1} users, ${cases.length} cases, ${samples.length + 3} samples, 16 tasks.`);
  console.log('Demo accounts: admin@vetpulse.dev / VetPulse!2026   priya.sharma@vetpulse.dev / VetPulse!2026');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
