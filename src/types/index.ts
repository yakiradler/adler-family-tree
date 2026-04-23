export type ViewMode = 'tree' | 'schematic' | 'timeline'
export type RelationshipType = 'parent-child' | 'spouse' | 'sibling'
export type EditRequestStatus = 'pending' | 'approved' | 'rejected'
export type UserRole = 'admin' | 'user'
export type Gender = 'male' | 'female'

export interface Profile {
  id: string
  full_name: string
  avatar_url?: string
  role: UserRole
}

export interface Member {
  id: string
  first_name: string
  last_name: string
  nickname?: string
  birth_date?: string
  death_date?: string
  hebrew_birth_date?: string
  hebrew_death_date?: string
  bio?: string
  photo_url?: string
  photos?: string[]
  gender?: Gender
  birth_order?: number
  created_by: string
}

export interface Relationship {
  id: string
  member_a_id: string
  member_b_id: string
  type: RelationshipType
}

export interface EditRequest {
  id: string
  requester_id: string
  requester_name?: string
  target_member_id: string
  target_member_name?: string
  change_data: Record<string, unknown>
  status: EditRequestStatus
  created_at: string
}
