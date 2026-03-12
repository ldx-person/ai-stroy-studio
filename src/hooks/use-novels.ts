'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Types
interface Novel {
  id: string
  title: string
  description: string | null
  cover: string | null
  genre: string | null
  status: string
  wordCount: number
  chapters: Chapter[]
  createdAt: string
  updatedAt: string
}

interface Chapter {
  id: string
  novelId: string
  title: string
  content: string
  wordCount: number
  order: number
  isPublished: boolean
  createdAt: string
  updatedAt: string
}

// Query keys
export const queryKeys = {
  novels: ['novels'] as const,
  novel: (id: string) => ['novels', id] as const,
}

// Fetch novels list
export function useNovels() {
  return useQuery({
    queryKey: queryKeys.novels,
    queryFn: async () => {
      const res = await fetch('/api/novels')
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      return data.novels as Novel[]
    },
  })
}

// Fetch single novel
export function useNovel(id: string | null) {
  return useQuery({
    queryKey: queryKeys.novel(id || ''),
    queryFn: async () => {
      if (!id) return null
      const res = await fetch(`/api/novels/${id}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      return data.novel as Novel
    },
    enabled: !!id,
  })
}

// Create novel mutation
export function useCreateNovel() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (novel: { title: string; description?: string; genre?: string }) => {
      const res = await fetch('/api/novels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novel),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      return data.novel as Novel
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.novels })
    },
  })
}

// Update novel mutation
export function useUpdateNovel() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; title?: string; description?: string; genre?: string; status?: string }) => {
      const res = await fetch('/api/novels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      return data.novel as Novel
    },
    onSuccess: (novel) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.novels })
      queryClient.invalidateQueries({ queryKey: queryKeys.novel(novel.id) })
    },
  })
}

// Delete novel mutation
export function useDeleteNovel() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/novels?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.novels })
    },
  })
}

// Create chapter mutation
export function useCreateChapter() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ novelId, title, order }: { novelId: string; title: string; order?: number }) => {
      const res = await fetch('/api/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId, title, order }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      return data.chapter as Chapter
    },
    onSuccess: (_, { novelId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.novels })
      queryClient.invalidateQueries({ queryKey: queryKeys.novel(novelId) })
    },
  })
}

// Update chapter mutation
export function useUpdateChapter() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, title, content }: { id: string; title?: string; content?: string }) => {
      const res = await fetch('/api/chapters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title, content }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      return data.chapter as Chapter
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.novels })
    },
  })
}

// Delete chapter mutation
export function useDeleteChapter() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/chapters?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.novels })
    },
  })
}
