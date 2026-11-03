// Who is signed in, and what they are in this CRM. Sign-in is the workspace's Supabase Auth (the
// same logins as every app in the workspace, and the workspace portal signs people in here too).
// Who may use the CRM, and with which roles, is the workspace's: core keeps the members, and
// crm_session() answers for the signed-in person (null = not a member).

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useAuthUser() {
  const [state, setState] = useState({ loading: true, user: null })
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ loading: false, user: data.session?.user ?? null }))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ loading: false, user: session?.user ?? null }))
    return () => data.subscription.unsubscribe()
  }, [])
  return state
}

export function useMembership(userId) {
  return useQuery({
    queryKey: ['fluidcrm', 'session', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('crm_session')
      if (error) throw error
      return data // null = not a member
    },
    staleTime: 60000,
  })
}

export async function signOut(queryClient) {
  await supabase.auth.signOut()
  queryClient.clear()
}

// ---------- the CRM's members, kept in the workspace's shared data ----------

const membersKey = ['fluidcrm', 'members']
const peopleKey = ['fluidcrm', 'people']

// Everyone in the CRM with their roles here (the workspace owner always, as admin)
export function useMembers() {
  return useQuery({
    queryKey: membersKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('members').select('id, auth_user_id, name, email, title, workspace_role, roles').order('name')
      if (error) throw error
      return data
    },
  })
}

// The workspace's employees, to add from
export function usePeople() {
  return useQuery({
    queryKey: peopleKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('people').select('id, name, email, title').eq('status', 'active').order('name')
      if (error) throw error
      return data
    },
  })
}

// Add or remove a member, and set their roles here: { personId, roles, active }
export function useSetMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ personId, roles = [], active = true }) => {
      const { error } = await supabase.rpc('set_member', { p_person_id: personId, p_roles: roles, p_active: active })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey }),
  })
}

// Their workspace login's password: it changes for every app in the workspace.
export async function changePassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}
