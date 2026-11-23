import type { CreateProjectInput, Project, UpdateProjectInput } from '@greenlit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'

export function useProjects() {
  useLiveQuery('library', [qk.projects])
  return useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>('/projects') })
}

export function useProject(id: string | null | undefined) {
  useLiveQuery(id ? `project:${id}` : null, [qk.project(id ?? '')], ['project.updated'])
  return useQuery({
    queryKey: qk.project(id ?? ''),
    queryFn: () => api.get<Project>(`/projects/${id}`),
    enabled: !!id,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<CreateProjectInput> & { name: string }) =>
      api.post<Project>('/projects', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  })
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateProjectInput) => api.patch<Project>(`/projects/${id}`, patch),
    onSuccess: (p) => {
      qc.setQueryData(qk.project(id), p)
      void qc.invalidateQueries({ queryKey: qk.projects })
    },
  })
}
