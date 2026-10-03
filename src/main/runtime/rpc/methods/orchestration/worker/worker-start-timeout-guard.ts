import { isWorkerStartTimeoutWithinTimerLimit } from '../../../../../../shared/orchestration-timing-budgets'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'

export function assertWorkerStartTimeoutWithinTimerLimit(timeoutMs: number | undefined): void {
  if (!isWorkerStartTimeoutWithinTimerLimit(timeoutMs)) {
    throw new OrchestrationError(
      'invalid_argument',
      '--timeout-ms is too large for worker-start transport grace; the derived timeout must fit within the timer limit.'
    )
  }
}
