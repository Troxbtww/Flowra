import { supabase } from './supabase'
import type { AnalysisResult, Conversation, DBTurn, PracticeFeedback } from './types'

export async function analyzeAndSave(text: string): Promise<string> {
  // Call AI via main process IPC
  const result = await window.flowraAPI.analyzeConversation(text)

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Analysis failed')
  }

  const analysis = result.data

  // Generate title from first turn or first line
  const title = analysis.turns[0]?.content.slice(0, 60) || text.slice(0, 60)

  // Save conversation to Supabase
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .insert({
      raw_text: text,
      title,
      overall_score: analysis.overall_score,
      scores: analysis.scores,
      category_counts: analysis.category_counts,
      summary: analysis.summary,
      turn_count: analysis.turn_count
    })
    .select('id')
    .single()

  if (convError || !conv) {
    throw new Error(`Failed to save conversation: ${convError?.message}`)
  }

  // Save turns to Supabase
  const turnsToInsert = analysis.turns.map((turn) => ({
    conversation_id: conv.id,
    turn_index: turn.turn_index,
    speaker: turn.speaker,
    content: turn.content,
    emotional_tone: turn.emotional_tone,
    intent: turn.intent,
    hidden_meaning: turn.hidden_meaning,
    tension_level: turn.tension_level,
    category: turn.category,
    is_key_moment: turn.is_key_moment,
    explanation: turn.explanation,
    alternatives: turn.alternatives
  }))

  const { error: turnsError } = await supabase
    .from('turns')
    .insert(turnsToInsert)

  if (turnsError) {
    throw new Error(`Failed to save turns: ${turnsError.message}`)
  }

  // Save progress snapshot for trend tracking
  const cc = analysis.category_counts || {}
  const keyMomentCount = analysis.turns.filter((t: any) => t.is_key_moment).length
  await supabase.from('progress_snapshots').insert({
    conversation_id: conv.id,
    overall_score: analysis.overall_score,
    clarity: analysis.scores.clarity || 0,
    listening: analysis.scores.listening || 0,
    emotional_control: analysis.scores.emotional_control || 0,
    conflict_handling: analysis.scores.conflict_handling || 0,
    persuasion: analysis.scores.persuasion || 0,
    alignment: analysis.scores.alignment || 0,
    total_turns: analysis.turn_count,
    key_moment_count: keyMomentCount,
    best_count: cc['Best'] || 0,
    strong_count: cc['Strong'] || 0,
    good_count: cc['Good'] || 0,
    unclear_count: cc['Unclear'] || 0,
    missed_count: cc['Missed Opportunity'] || 0,
    risky_count: cc['Risky'] || 0,
    misread_count: cc['Misread Signal'] || 0,
    escalation_count: cc['Escalation'] || 0,
    blunder_count: cc['Blunder'] || 0
  })

  return conv.id
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data as Conversation
}

export async function getTurns(conversationId: string): Promise<DBTurn[]> {
  const { data, error } = await supabase
    .from('turns')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('turn_index', { ascending: true })

  if (error) return []
  return data as DBTurn[]
}

export async function getConversationHistory(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return []
  return data as Conversation[]
}

export async function deleteConversation(id: string): Promise<void> {
  await supabase.from('conversations').delete().eq('id', id)
}

export interface ProgressSnapshot {
  id: string
  created_at: string
  conversation_id: string
  overall_score: number
  clarity: number
  listening: number
  emotional_control: number
  conflict_handling: number
  persuasion: number
  alignment: number
  total_turns: number
  key_moment_count: number
  best_count: number
  strong_count: number
  good_count: number
  unclear_count: number
  missed_count: number
  risky_count: number
  misread_count: number
  escalation_count: number
  blunder_count: number
}

export async function getProgressSnapshots(): Promise<ProgressSnapshot[]> {
  const { data, error } = await supabase
    .from('progress_snapshots')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) return []
  return data as ProgressSnapshot[]
}

export async function evaluatePractice(
  originalTurn: string,
  context: string,
  rewrite: string
): Promise<PracticeFeedback> {
  const result = await window.flowraAPI.evaluatePractice(originalTurn, context, rewrite)
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Practice evaluation failed')
  }
  return result.data
}
