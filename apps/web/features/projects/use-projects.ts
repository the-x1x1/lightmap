'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import type { ProjectDetailDto, ProjectDto, ViewpointDto } from '@/lib/api-types';

export function useProjects(enabled: boolean) {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: ProjectDto[] }>('/api/projects'),
    enabled,
    staleTime: 30_000,
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => api.get<{ project: ProjectDetailDto }>(`/api/projects/${id}`),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useProjectMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['projects'] });
  return {
    create: useMutation({
      mutationFn: (body: {
        name: string;
        description?: string | null;
        shootDate?: string | null;
      }) => api.post<{ project: ProjectDto }>('/api/projects', body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        ...patch
      }: {
        id: string;
        name?: string;
        description?: string | null;
        shootDate?: string | null;
      }) => api.patch<{ project: ProjectDto }>(`/api/projects/${id}`, patch),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete<void>(`/api/projects/${id}`),
      onSuccess: invalidate,
    }),
    saveViewpoint: useMutation({
      mutationFn: ({ projectId, body }: { projectId: string; body: unknown }) =>
        api.post<{ viewpoint: ViewpointDto }>(`/api/projects/${projectId}/viewpoints`, body),
      onSuccess: invalidate,
    }),
    updateViewpoint: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        api.patch<{ viewpoint: ViewpointDto }>(`/api/viewpoints/${id}`, body),
      onSuccess: invalidate,
    }),
    removeViewpoint: useMutation({
      mutationFn: (id: string) => api.delete<void>(`/api/viewpoints/${id}`),
      onSuccess: invalidate,
    }),
  };
}
