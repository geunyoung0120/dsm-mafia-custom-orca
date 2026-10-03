import { defineMethod } from '../../../core'
import { ResetParams } from '../schemas'
import {
  clearRunCommunitySkillContexts,
  clearAttachmentCommunitySkillContexts
} from '../../../../orchestration/community-skill-inheritance'

export const ORCHESTRATION_RESET_METHODS = [
  defineMethod({
    name: 'orchestration.reset',
    params: ResetParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      if (params.all) {
        runtime.stopOrchestrationFederationRelay()
        db.resetAll()
        clearRunCommunitySkillContexts(db)
        clearAttachmentCommunitySkillContexts(db)
        return { reset: 'all' }
      }
      if (params.tasks) {
        runtime.stopOrchestrationFederationRelay()
        db.resetTasks()
        clearAttachmentCommunitySkillContexts(db)
        return { reset: 'tasks' }
      }
      if (params.messages) {
        db.resetMessages()
        return { reset: 'messages' }
      }
      throw new Error('Invalid reset scope')
    }
  })
]
