# Organizer Onboarding and Admin Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Let a rider submit a real organizer application, let admins approve or reject it, and let admins provision an already-approved organizer account.

**Architecture:** Keep public signup rider-only. Add a shared organizer-account contract to both runtime backends and protect mutations with the existing session-cookie Server Action boundary. The client provider applies refreshed snapshots; the admin console reads protected server-backed verification records instead of React-only status overrides.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Server Actions, Vitest, Playwright, Prisma 7/PostgreSQL.

## Global Constraints

- Preserve \`signUpRider\` as \`rider\` / \`UNVERIFIED\`.
- Self-service application requires login and creates \`organizer\` / \`PENDING\` plus a pending \`OrganizerProfile\`.
- Only an admin can review or create organizers; authorize inside every Server Action and backend method.
- Admin creation makes the user and profile \`APPROVED\` in one operation.
- Do not add email invitations, document uploads, or pending-organizer event drafts.
- Reuse an existing dev server for browser verification.
- Do not modify the unrelated flexible check-in work already dirty in the worktree.

---

### Task 1: Add the organizer lifecycle to the backend contract

**Files:**
- Modify: \`src/features/tambike-demo/types.ts\`
- Modify: \`src/server/backend.ts\`
- Modify: \`tests/server/backend-domain.test.ts\`

**Interfaces:**
- Produces:
  \`\`\`ts
  export interface OrganizerApplicationInput {
    organizerType: string;
    displayName: string;
    realName: string;
    contactNumber: string;
    fbLink: string;
    pastEventLinks: string[];
  }

  export interface AdminCreateOrganizerInput extends OrganizerApplicationInput {
    email: string;
    password: string;
    area: string;
  }

  export interface OrganizerVerificationRecord {
    id: string;
    ownerUserId: string;
    ownerEmail: string;
    ownerName: string;
    ownerRole: "organizer";
    status: VerificationStatus;
    organizerType: string;
    displayName: string;
    realName: string;
    contactNumber: string;
    fbLink: string;
    pastEventLinks: string[];
    pastEvents: number;
    activeEvents: number;
    adminNotes?: string;
  }
  \`\`\`

- Produces backend methods:
  \`\`\`ts
  applyAsOrganizer(sessionToken: string, input: OrganizerApplicationInput): Promise<OrganizerVerificationRecord>;
  reviewOrganizerApplication(sessionToken: string, organizerId: string, status: "APPROVED" | "REJECTED", adminNotes?: string): Promise<OrganizerVerificationRecord>;
  createOrganizerForAdmin(sessionToken: string, input: AdminCreateOrganizerInput): Promise<OrganizerVerificationRecord>;
  listOrganizerVerifications(sessionToken: string): Promise<OrganizerVerificationRecord[]>;
  \`\`\`

- [ ] **Step 1: Write the failing lifecycle tests**

  Add typed fixture constants to \`tests/server/backend-domain.test.ts\`, then add these tests:

  \`\`\`ts
  test("moves a rider into a pending organizer application and keeps event creation blocked", async () => {
    const backend = await createTambikeTestBackend();
    const rider = await backend.loginWithPassword("mina.rider@example.com", "password123");

    const application = await backend.applyAsOrganizer(rider.sessionToken, validApplicationInput);

    expect(application).toMatchObject({ status: "PENDING", ownerEmail: "mina.rider@example.com" });
    await expect(backend.getCurrentUser(rider.sessionToken)).resolves.toMatchObject({
      role: "organizer",
      verificationStatus: "PENDING",
      organizerProfileId: application.id,
    });
    await expect(backend.createEventDraft(rider.sessionToken, validDraftInput)).rejects.toThrow("FORBIDDEN");
  });

  test("allows only an admin to approve a pending organizer and unlocks event creation", async () => {
    const backend = await createTambikeTestBackend();
    const rider = await backend.loginWithPassword("mina.rider@example.com", "password123");
    const admin = await backend.loginWithPassword("admin@bayanko.ph", "secret_123");
    const application = await backend.applyAsOrganizer(rider.sessionToken, validApplicationInput);

    await expect(backend.reviewOrganizerApplication(rider.sessionToken, application.id, "APPROVED")).rejects.toThrow("FORBIDDEN");
    await backend.reviewOrganizerApplication(admin.sessionToken, application.id, "APPROVED", "Verified page");
    await expect(backend.createEventDraft(rider.sessionToken, validDraftInput)).resolves.toMatchObject({
      title: validDraftInput.title,
    });
  });

  test("lets an admin create an immediately approved organizer and rejects duplicate email", async () => {
    const backend = await createTambikeTestBackend();
    const admin = await backend.loginWithPassword("admin@bayanko.ph", "secret_123");

    const created = await backend.createOrganizerForAdmin(admin.sessionToken, validAdminOrganizerInput);

    expect(created).toMatchObject({ ownerEmail: "host@example.com", status: "APPROVED", ownerRole: "organizer" });
    await expect(backend.createOrganizerForAdmin(admin.sessionToken, validAdminOrganizerInput)).rejects.toThrow("INVALID_INPUT");
  });
  \`\`\`

- [ ] **Step 2: Run the tests to verify RED**

  Run: \`npm run test:server -- tests/server/backend-domain.test.ts\`

  Expected: failure because the four organizer methods and the input types do not exist.

- [ ] **Step 3: Implement the minimal in-memory lifecycle**

  In \`src/server/backend.ts\`:

  - Add audit actions \`ORGANIZER_APPLICATION_SUBMITTED\`, \`ORGANIZER_APPLICATION_REVIEWED\`, and \`ORGANIZER_CREATED_BY_ADMIN\`.
  - Create a private \`Map<string, OrganizerVerificationRecord>\`, seed it from the existing demo organizer/user pairing, and use it instead of mutating the static \`organizers\` data.
  - Validate every trimmed organizer field, one non-empty past-event link, a unique email, one profile per applicant, and the existing minimum password length.
  - Make \`applyAsOrganizer\` require a logged-in rider with no organizer profile, assign role \`organizer\`, status \`PENDING\`, and \`organizerProfileId\`.
  - Make \`reviewOrganizerApplication\` use \`requireRole(sessionToken, "admin")\`, update both the record and owner status, and audit the decision.
  - Make \`createOrganizerForAdmin\` use \`requireRole(sessionToken, "admin")\`, hash its password, create its user/profile as \`APPROVED\`, and audit the creation.
  - Make \`listOrganizerVerifications\` admin-only and return cloned records.

  Use this review transition:

  \`\`\`ts
  const admin = this.requireRole(sessionToken, "admin");
  const record = this.requireOrganizerVerification(organizerId);
  const owner = this.requireUserById(record.ownerUserId);
  const next = { ...record, status, adminNotes: adminNotes?.trim() || undefined };
  this.organizerVerifications.set(record.id, next);
  this.users.set(owner.id, {
    ...owner,
    role: "organizer",
    verificationStatus: status,
    organizerProfileId: record.id,
  });
  this.audit("ORGANIZER_APPLICATION_REVIEWED", admin.id, record.id);
  return this.cloneOrganizerVerification(next);
  \`\`\`

- [ ] **Step 4: Run the tests to verify GREEN**

  Run: \`npm run test:server -- tests/server/backend-domain.test.ts\`

  Expected: all existing backend-domain tests plus the three organizer lifecycle tests pass.

- [ ] **Step 5: Commit the backend contract**

  \`\`\`powershell
  git add src/features/tambike-demo/types.ts src/server/backend.ts tests/server/backend-domain.test.ts
  git diff --cached --check
  git commit -m "feat: add organizer verification lifecycle"
  \`\`\`

### Task 2: Implement Prisma parity and protected Server Actions

**Files:**
- Modify: \`src/server/prisma-backend.ts\`
- Modify: \`src/server/actions.ts\`
- Modify: \`tests/server/backend-domain.test.ts\`

**Interfaces:**
- Consumes: Task 1 inputs, records, and audit actions.
- Produces:
  \`\`\`ts
  export async function applyAsOrganizerAction(input: OrganizerApplicationInput): Promise<{ state: DemoState; organizer: OrganizerVerificationRecord }>;
  export async function reviewOrganizerApplicationAction(id: string, status: "APPROVED" | "REJECTED", notes?: string): Promise<{ state: DemoState; organizer: OrganizerVerificationRecord }>;
  export async function createOrganizerForAdminAction(input: AdminCreateOrganizerInput): Promise<{ state: DemoState; organizer: OrganizerVerificationRecord }>;
  export async function listOrganizerVerificationsAction(): Promise<OrganizerVerificationRecord[]>;
  \`\`\`

- [ ] **Step 1: Write the failing backend-parity test**

  Add this test:

  \`\`\`ts
  test("exposes the full organizer lifecycle on the runtime backend contract", async () => {
    const backend = await createTambikeTestBackend();
    expect(backend.applyAsOrganizer).toBeTypeOf("function");
    expect(backend.reviewOrganizerApplication).toBeTypeOf("function");
    expect(backend.createOrganizerForAdmin).toBeTypeOf("function");
    expect(backend.listOrganizerVerifications).toBeTypeOf("function");
  });
  \`\`\`

- [ ] **Step 2: Run the test to verify RED**

  Run: \`npm run test:server -- tests/server/backend-domain.test.ts\`

  Expected: the parity test fails until the Prisma backend methods match the in-memory contract.

- [ ] **Step 3: Implement the database and action boundary**

  In \`src/server/prisma-backend.ts\`, implement all lifecycle mutations with \`this.prisma.$transaction\`:

  \`\`\`ts
  await this.prisma.$transaction(async (tx) => {
    const profile = await tx.organizerProfile.create({
      data: {
        userId: user.id,
        organizerType: input.organizerType.trim(),
        displayName: input.displayName.trim(),
        realName: input.realName.trim(),
        contactNumber: input.contactNumber.trim(),
        fbLink: input.fbLink.trim(),
        reason: "Self-service organizer application",
        pastEventLinks: input.pastEventLinks.map((link) => link.trim()).filter(Boolean),
        verificationStatus: "PENDING",
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { role: "organizer", verificationStatus: "PENDING" },
    });
    return profile;
  });
  \`\`\`

  For queue queries, use \`OrganizerProfile.findMany({ include: { user: true, _count: { select: { events: true } } } })\` and map to the Task 1 record. Return \`adminNotes\` only from that admin-protected method.

  In \`src/server/actions.ts\`, read the cookie-backed token for each call and delegate; never accept a session token from the client:

  \`\`\`ts
  export async function applyAsOrganizerAction(input: OrganizerApplicationInput) {
    const backend = await getTambikeBackend();
    const token = await readRequiredSessionToken();
    const organizer = await backend.applyAsOrganizer(token, input);
    return { state: await snapshot(token), organizer };
  }
  \`\`\`

  Implement review and admin-create with the same shape. \`listOrganizerVerificationsAction\` must read the required token before calling the admin-only backend method.

- [ ] **Step 4: Run the test to verify GREEN**

  Run: \`npm run test:server -- tests/server/backend-domain.test.ts\`

  Expected: the contract test and all lifecycle tests pass.

- [ ] **Step 5: Commit the persistent workflow**

  \`\`\`powershell
  git add src/server/prisma-backend.ts src/server/actions.ts tests/server/backend-domain.test.ts
  git diff --cached --check
  git commit -m "feat: persist organizer applications"
  \`\`\`

### Task 3: Connect the rider and admin UI to server-backed actions

**Files:**
- Modify: \`src/features/tambike-demo/demo-provider.tsx\`
- Modify: \`src/features/tambike-demo/tambike-screen.tsx\`
- Modify: \`src/features/admin/admin-console.tsx\`
- Create: \`src/app/admin/verifications/organizers/create/page.tsx\`
- Modify: \`tests/tambike-demo.spec.ts\`

**Interfaces:**
- Consumes: the four Task 2 actions.
- Produces provider methods \`applyAsOrganizer\`, \`reviewOrganizerApplication\`, \`createOrganizerForAdmin\`, and \`listOrganizerVerifications\`.

- [ ] **Step 1: Write the failing browser tests**

  Add these scenarios:

  \`\`\`ts
  test("a signed-in rider submits an organizer application and sees a pending confirmation", async ({ page }) => {
    await logInAs(page, "rider");
    await page.goto("/organizer/apply");
    await page.getByLabel("Organizer type").fill("Community ride host");
    await page.getByLabel("Display name").fill("Mina's Tambike Crew");
    await page.getByLabel("Real name").fill("Mina Rider");
    await page.getByLabel("Contact number").fill("09171234567");
    await page.getByLabel("FB / page link").fill("https://facebook.com/minatambike");
    await page.getByLabel("Past event links").fill("https://facebook.com/events/mina-ride");
    await page.getByRole("button", { name: "Submit organizer application" }).click();
    await expect(page.getByText("Your organizer application is pending review.")).toBeVisible();
  });

  test("an admin can create an approved organizer", async ({ page }) => {
    await logInAs(page, "admin");
    await page.goto("/admin/verifications/organizers/create");
    await page.getByLabel("Email").fill("host@example.com");
    await page.getByLabel("Temporary password").fill("hostpass123");
    await page.getByRole("button", { name: "Create approved organizer" }).click();
    await expect(page.getByText("Organizer account created and approved.")).toBeVisible();
  });
  \`\`\`

- [ ] **Step 2: Run the browser tests to verify RED**

  Reuse a running Tambike server. Run:

  \`\`\`powershell
  $env:TAMBIKE_SKIP_TEST_RESET='true'
  npm run test:e2e -- --grep "organizer application|create an approved organizer" --project=desktop
  \`\`\`

  Expected: both tests fail because the current form is a prototype and the create route is absent.

- [ ] **Step 3: Implement the real forms**

  - Add provider methods that call each Task 2 action and then call existing \`applyState(result.state)\`. Keep protected organizer records out of global \`DemoState\`.
  - Replace \`OrganizerApplyScreen\` with a login-guarded form. Use exact input labels from the tests; parse non-empty newline-separated past event links. Disable the submit button while pending. Show the exact success sentence from Step 1.
  - In \`AdminConsole\`, remove \`organizerStatusOverrides\` / \`setOrganizerStatus\`. Fetch the protected queue only in organizer sections, call the real approve/reject action with an optional \`Admin notes\` textarea, then replace the queue with the action result.
  - Add a \`Create organizer\` link to the verification queue.
  - Add the thin create route:
    \`\`\`tsx
    import { AdminConsole } from "@/features/admin/admin-console";

    export default function Page() {
      return <AdminConsole section="organizers" createOrganizer />;
    }
    \`\`\`
  - Extend the console prop with \`createOrganizer?: boolean\`. Render an admin-only form requiring email, temporary password, area, and every organizer field. On success show \`Organizer account created and approved.\`.

- [ ] **Step 4: Run the browser tests to verify GREEN**

  Run the Step 2 command.

  Expected: both tests pass and state comes from Server Actions, not local overrides.

- [ ] **Step 5: Commit the UI flow**

  \`\`\`powershell
  git add src/features/tambike-demo/demo-provider.tsx src/features/tambike-demo/tambike-screen.tsx src/features/admin/admin-console.tsx src/app/admin/verifications/organizers/create/page.tsx tests/tambike-demo.spec.ts
  git diff --cached --check
  git commit -m "feat: add organizer application and admin provisioning"
  \`\`\`

### Task 4: Verify the completed feature

**Files:**
- Verify: every file changed in Tasks 1–3.

- [ ] **Step 1: Run domain tests**

  Run: \`npm run test:server -- tests/server/backend-domain.test.ts\`

  Expected: application, approval, direct provisioning, and existing domain tests pass.

- [ ] **Step 2: Run targeted browser coverage**

  \`\`\`powershell
  $env:TAMBIKE_SKIP_TEST_RESET='true'
  npm run test:e2e -- --grep "organizer application|create an approved organizer|approved organizer can create an event draft" --project=desktop
  \`\`\`

  Expected: all three scenarios pass.

- [ ] **Step 3: Run static verification**

  \`\`\`powershell
  npm run lint
  npm run build
  git diff --check
  \`\`\`

  Expected: all commands exit 0.

- [ ] **Step 4: Run an in-app browser smoke**

  In the Codex browser, use the existing local Tambike server. Log in as a rider and submit an application. Log in as admin and approve it or create a direct organizer. Confirm an approved organizer can open \`/organizer/events/create\`. Report separately if the browser cannot be used.

- [ ] **Step 5: Commit only organizer-workflow files**

  \`\`\`powershell
  git add src/features/tambike-demo/types.ts src/server/backend.ts src/server/prisma-backend.ts src/server/actions.ts src/features/tambike-demo/demo-provider.tsx src/features/tambike-demo/tambike-screen.tsx src/features/admin/admin-console.tsx src/app/admin/verifications/organizers/create/page.tsx tests/server/backend-domain.test.ts tests/tambike-demo.spec.ts
  git diff --cached --check
  git commit -m "feat: complete organizer verification workflow"
  \`\`\`

  Do not stage the unrelated flexible check-in migration, schema, seed, check-in tests, or check-in hunks from shared backend files.
