# Dirigo scheduler and worker design

## 1. Purpose

*Implementation status: partial*

This document defines the scheduler, OpenCode runner, subsequent container isolation and session handover to safely execute the file queue.
The global default concurrency is 20 and the working default timeout is 20 minutes.

## 2. Components

*Implementation status: partial*

| Components | Responsibilities |
|---|---|
| Scanner | pending file discovery and parsing |
| Dependency Resolver | Confirm `pre-task` completion |
| Dispatcher | Assign based on slot and fairness |
| Lease Manager | Duplicate Execution Prevention and Failover |
| Runner | Run subprocess or container |
| Finalizer | Move report and status |
| Enqueuer | `next-task` subsequent enqueue |
| Handover Manager | 70% Session Conversion |

## 3. Scheduler Loop

*Implementation status: partial*

The default polling period is 10 seconds and is configurable with `DIRIGO_SCHEDULER_INTERVAL_MS`.
File monitoring events are for shorter delays and polling is the criterion for accuracy.
Every loop is in the order of expiry lease recovery, pending scan, candidate alignment, and slot assignment.

```mermaid
flowchart TD
T [2-second tick] --> L [Restore expired lease]
L --> S [pending scan]
S --> P [frontmatter verification]
  P --> D{pre-task done?}
D -- No --> B [remain blocked]
D -- Yes --> C {Global/User Slot?}
C -- No --> W [wait for next tick]
C -- Yes --> R [atom rename]
R --> X [create task_run lease]
X --> E [Run Runner]
```

## 4. Candidate selection

*Implementation status: partial*

the pending file is stable sorted by creation time, date number, and task ID.
In multiple users, the monopoly of one user is prevented with a round-robin per user.
The parsing error operation logs the synchronization error without executing it.
do not pick up tasks from disabled users and archived projects.

## 5. Determining dependency

*Implementation status: implemented*

| `pre-task` status | Processing |
|---|---|
| null | executable |
| done | Actionable |
| pending | Pending |
| in-progress | standby |
| failed | Show blocked reason, do not autoplay |
| None | invalid_dependency Error |

Self-reference and circulation are rejected at the time of ordering and tested defensively at the time of scanning.
The precedence status is based on the file location, and the DB is used for fast candidate lookup.

## 6. Concurrency

*Implementation status: partial*

There are 20 global execution slots.
The slot is acquired when task_run is running and returned after the exit cleanup.
The scheduler retains a session-level PostgreSQL advisory lock; only its holder polls and publishes `leader_pid`.
The first user limit is the same as the global limit, and the second user limit is applied separately.
Administrators can set new limits while running, but do not force quit existing tasks.

## 7. Pickup transactions

*Implementation status: implemented*

1. Read the candidate file and hash.
2. Lock the DB row with `for update skip locked`.
3. Double-check slots and dependencies.
4. Atom rename the file from pending to in-progress.
5. Save the task status, new task_run, and lease expiration.
6. After committing, deliver the run to the runner.

if DB commit fails after rename, the regulator finds the in-progress file and recovers it.
When the runner delivery fails, close run with failed and move the file to failed.

## 8. OpenCode subprocess contracts

*Implementation status: partial*

The command type consists of the following array arguments and prohibits shell string connection.

```text
opencode run --format json --file <task-relative-path>
```

The actual support flags are validated with a fixed version of the OpenCode CLI help at implementation.
Select the executable path and allow arguments from the allowlist in the admin settings.
The working directory is the approved checkout or workspace for that project.
The project setting's `workdir` accepts either a path relative to the project root or an absolute path. `.` therefore selects the project root; an omitted value selects `<project-root>/workspace`. A relative path may not escape the project root.
Its real path must be below `DIRIGO_DATA_ROOT` or a colon-delimited absolute root in `DIRIGO_WORKDIR_ALLOWLIST`; symlink escapes fail the task and are recorded in its report.
The work order path is communicated to the project relative path.

## 9. Environment variables

*Implementation status: implemented*

| Variables | Uses | Secrets |
|---|---|---|
| `DIRIGO_USER` | User scope | No |
| `DIRIGO_PROJECT` | Project scope | No |
| `DIRIGO_RUN` | Run ID | No |
| Supplier Key | LLM Authentication | Yes |

The runner inherits only `PATH`, `LANG`, and `TZ`. It constructs run metadata itself and maps `HOME` plus the XDG data/config/cache homes to mode-0700 directories under the immutable user slug. Server provider keys and wildcard API-key/token variables are never inherited; scoped LLM credential injection remains planned for #009.
Secret values are not included in process arguments, logs, or reports.

## 10. Capture logs

*Implementation status: partial*

separate stdout and stderr to capture streaming.
Each record is assigned a run ID, sequence, time, and stream.
Place an upper limit on the line and the overall log size and mark truncation when exceeded.
Mask the token, Authorization header, and known secret pattern.
Only the refined logs are exposed in the UI, and the source access is restricted to the administrator.

## 11. Timeout and end

*Implementation status: implemented*

if there is no `timeout_min` in the frontmatter, apply 20 minutes.
When the time limit is reached, a normal end signal is sent and a 10-second grace period is given.
Then force quit the remaining process group.
the status of the timeout run is` timed_out `and the status of the task is` failed `.
Failure_reason is mandatory because there may be no exit code.

## 12. Judgment of Completion

*Implementation status: partial*

| Condition | task result |
|---|---|
| exit code 0 + valid report | done |
| exit code 0 + No report/Error | failed |
| exit code non-zero | failed |
| timeout | failed |
| end signal | failed |
| state movement failed | retry after retaining finalizing |

It is not done solely with the output that claims to be successful.
After verifying the report frontmatter and the corresponding task number, the status is confirmed.

## 13. Finalizer order

*Implementation status: partial*

1. Wait for the subprocess termination and all log drain.
2. Generate an ad hoc report and fsync it.
3. Rename the report atom to reports.
4. Atomize the work order to done or failed.
5. Update DB task and task_run.
6. Return slots and issue completion events.

Keep the intermediate failure in a retryable `finalizing` run state.
Generation of the same run report is handled idempotently.

## 14. next-task Automatic enqueue

*Implementation status: partial*

Evaluate 'next-task' only when the current task is done.
Subsequent files must exist in the draft area or as a defined template.
Verify that the subsequent `pre-task' points to the current file.
If you already have a pending anomaly, do not create a duplicate.
If the condition is met, move the atom to pending and upsert it to the DB.
The current failed operation does not auto-enqueue the follow-up.

## 15. Retry

*Implementation status: implemented*

The automatic retry default is 0.
Only the infrastructure temporary error can retry the exponential backoff in the scope of the management settings.
Code failures and validation failures require a reinstatement of the user.
The retry creates a new attempt and run ID in the same task.
Link to the run history without overwriting previous logs and reports.

## 16. Failover

*Implementation status: partial*

| Failure | Recovery |
|---|---|
| Scheduler quit | New leader scans for expired leases |
| quit worker | task failed or retry by policy |
| DB disconnected | New pickup interrupted, execution results temporarily preserved |
| file storage cut off | start running · stop finalize |
| Duplicate assignment | Rename or DB lock, whichever fails first |

The runner heartbeat is 15 seconds by default, and the lease is 60 seconds by default.
Even for long, no-output tasks, the process survival and heartbeat are checked separately.

## 17. Isolating secondary containers

*Implementation status: planned*

```mermaid
flowchart LR
  S[Scheduler] --> R[Container Runner]
R --> I [fixed image]
R --> V [work volume per user]
R --> N [Limited Network]
R --> C [CPU/Memory/PID Quota]
  I --> O[OpenCode]
```

Create unprivileged containers for each task and remove them after completion.
The root filesystem only mounts read-only, writeable work volumes.
Do not mount volumes and sockets of other users.
Do not expose the host container runtime socket to the work container.
Block the default network and only allow project allowlist destinations.

## 18. Resource limit per user

*Implementation status: planned*

| Resources | Default Policy |
|---|---|
| concurrent operations | 2 per user, global 20 |
| CPU | 2 vCPU per task |
| Memory | 4 GiB per operation |
| PID | 256 per task |
| Temporary disk | 10 GiB per operation |
| Execution time | 20 minutes by default, up to 24 hours |
| Log | Max size per run |

The value is the initial recommendation and will be changed by the administrator to suit the service capacity.
Over the limit is left in the report with the explicit failure_reason.

## 19. Image and supply chain

*Implementation status: planned*

The container image is fixed with digest.
Write the OpenCode and runtime versions to the image metadata.
Images are only imported from the Approval Registry after a vulnerability scan.
On-the-fly package installations follow locking files and project policies.

## 20. Measuring Session Context

*Implementation status: partial*

Update the cumulative context token and model limits after every LLM call.
Calculate as` context_ratio = context_tokens/context_limit `.
If the rate is below 0.70, keep the current session.
Start a single handover operation if it is 0.70 or higher and not in the middle of a handover.
Concurrent requests lock session rows to prevent duplicate handovers.

## 21. Handover flow

*Implementation status: partial*

```mermaid
sequenceDiagram
participant Chat as Chatbot
  participant DB as PostgreSQL
participant FS as project documentation
Chat- > > DB: context_ratio update
DB--> > Chat: 70% threshold reached
Chat- > > Chat: Summary of Decisions, Progress, and Questions
Chat- > > FS: rename after draft project.next.md
Chat- > > DB: Existing session = handed_over
Chat- > > DB: create new session with continued_from
Chat- > > FS: Load guide/proposal/next
Chat--> > Chat: Continue to respond in new session
```

It only displays a short handover notification to the user and does not require any further manipulation.
The handover document includes goals, decisions, completions, progress, obstacles, and the following actions:
The original dialogue text and secret values are not duplicated in the document.
On write failure, retry on the next call without closing the existing session.

## 22. Email Completion Notification

*Implementation status: partial*

Atomically calculates the number of terminal jobs in the same bundle of orders in the project.
If all actions are done or failed, schedule the result summary email.
prevent duplicate shipments with the idempotency key of the notification.
Email failures are independent retries without reverting the working state.

## 23. Operational metrics

*Implementation status: partial*

- pending depth and longest latency
- Number of runs and global and user slot utilization
- Percentage of successes, failures and timeouts
- Execution time and queue wait time atmosphere
- lease expires and duplicate pickup attempts
- Log truncation, number of failed report validation
- Successes/failures and number of handovers per session

## 24. Validation checklist

*Implementation status: partial*

- No more than 20 global running tasks.
- Do not execute if `pre-task' is not done.
- No two workers will perform the same task at the same time.
- Reports are generated from all exit routes.
- timeout organizes up to the process group and moves to failed.
- Only successful tasks enqueue the next-task.
- Containers cannot access other user data.
- After 70% handover, the new session will auto-connect.
