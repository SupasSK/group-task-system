import type { SupabaseClient } from '@supabase/supabase-js'

export type ActivityAction =
  | 'group_created' | 'member_added'
  | 'task_created' | 'task_updated' | 'task_status_changed'
  | 'task_assigned' | 'task_accepted' | 'task_declined' | 'task_claimed'
  | 'comment_added' | 'decision_added' | 'file_uploaded'

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
