import type { SupabaseClient } from '@supabase/supabase-js'

export type ActivityAction =
  | 'group_created' | 'member_added' | 'member_removed'
  | 'task_created' | 'task_updated' | 'task_deleted' | 'task_status_changed'
  | 'task_assigned' | 'task_accepted' | 'task_declined' | 'task_claimed'
  | 'task_joined' | 'task_feedback_added'
  | 'comment_added' | 'decision_added' | 'file_uploaded'
  | 'eval_round_opened' | 'eval_round_closed'

export async function logActivity(
  supabase: SupabaseClient,
  p: {
    groupId: string
    action: ActivityAction
    entityType?: 'task' | 'group' | 'member' | 'file' | 'comment'
    entityId?: string
    payload?: Record<string, unknown>
  }
) {
  const { data, error } = await supabase.rpc('log_activity', {
    p_group_id: p.groupId,
    p_action_type: p.action,
    p_entity_type: p.entityType ?? null,
    p_entity_id: p.entityId ?? null,
    p_payload: p.payload ?? {},
  })
  if (error) console.error('logActivity failed:', error.message)
  return data as number | null
}
