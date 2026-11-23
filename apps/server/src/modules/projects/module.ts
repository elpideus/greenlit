import { CreateProjectInput, Project, UpdateProjectInput } from '@greenlit/shared'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { IdParams, Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { projects } from './schema.ts'
import { ProjectsService } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    projects: ProjectsService
  }
}

export default defineModule({
  id: 'projects',
  name: 'Projects',
  description: 'Projects group media, editing projects and posts.',
  dependsOn: ['users'],
  permissions: {
    'projects.read': { description: 'See projects', roles: ['reviewer'] },
    'projects.manage': { description: 'Create, rename, hide and delete projects', roles: [] },
  },
  setup(ctx) {
    const svc = new ProjectsService(ctx)
    ctx.services.provide('projects', svc)

    ctx.versions.register('project', {
      labels: {
        name: 'name',
        description: 'description',
        color: 'colour',
        hiddenFrom: 'visibility',
        archivedAt: 'archive state',
      },
      coalesceSeconds: 60,
      snapshot: async (id) => {
        const [r] = await ctx.db.select().from(projects).where(eq(projects.id, id))
        if (!r) return null
        return {
          name: r.name,
          description: r.description,
          color: r.color,
          coverMediaId: r.coverMediaId,
          hiddenFrom: r.hiddenFrom,
          archivedAt: r.archivedAt?.toISOString() ?? null,
          deletedAt: r.deletedAt?.toISOString() ?? null,
        }
      },
      restore: async (id, d) => {
        await ctx.db
          .update(projects)
          .set({
            name: d.name as string,
            description: d.description as string,
            color: (d.color as string) ?? null,
            coverMediaId: (d.coverMediaId as string) ?? null,
            hiddenFrom: (d.hiddenFrom as string[]) ?? [],
            archivedAt: d.archivedAt ? new Date(d.archivedAt as string) : null,
            deletedAt: d.deletedAt ? new Date(d.deletedAt as string) : null,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, id))
        ctx.events.emit('project.updated', { id })
      },
    })

    ctx.entities.register('project', {
      canView: (id, actor) => svc.canView(id, actor),
      summarize: async (ids, actor) =>
        (await svc.many(ids, actor)).map((p) => ({
          type: 'project',
          id: p.id,
          title: p.name,
          thumbnailUrl: p.coverUrl,
          kind: 'project',
          href: `/projects/${p.id}`,
          projectId: p.id,
        })),
    })
    ctx.realtime.guard('project', (actor, topic) => svc.canView(topic.split(':')[1]!, actor))

    const tags = ['Projects']
    route(ctx.api, {
      method: 'get',
      path: '/projects',
      summary: 'Projects you can see',
      tags,
      access: 'projects.read',
      query: z.object({
        q: z.string().optional(),
        archived: z.coerce.boolean().optional(),
        kind: z.enum(['project', 'brand']).optional(),
      }),
      response: z.array(Project),
      handler: ({ actor, query }) => svc.list(actor, query),
    })
    route(ctx.api, {
      method: 'get',
      path: '/projects/{id}',
      summary: 'One project',
      tags,
      access: 'projects.read',
      params: IdParams,
      response: Project,
      handler: ({ actor, params }) => svc.get(params.id, actor),
    })
    route(ctx.api, {
      method: 'post',
      path: '/projects',
      summary: 'Create a project',
      tags,
      access: 'projects.manage',
      body: CreateProjectInput,
      response: Project,
      status: 201,
      handler: ({ actor, body }) => svc.create(body, actor),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/projects/{id}',
      summary: 'Change a project',
      tags,
      access: 'projects.manage',
      params: IdParams,
      body: UpdateProjectInput,
      response: Project,
      handler: ({ actor, params, body }) => svc.update(params.id, body, actor),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/projects/{id}',
      summary: 'Delete a project (its media stay in the library, without a project)',
      tags,
      access: 'projects.manage',
      params: IdParams,
      response: Ok,
      handler: async ({ actor, params }) => {
        await svc.remove(params.id, actor)
        return { ok: true as const }
      },
    })

    ctx.mcp.tool({
      name: 'projects_list',
      description:
        'List projects (id, kind, name, counts). Optional text filter. Kind "brand" = a brand kit (see brand_kit).',
      input: { q: z.string().optional(), kind: z.enum(['project', 'brand']).optional() },
      access: 'projects.read',
      readOnly: true,
      handler: async ({ q, kind }, { actor }) =>
        (await svc.list(actor, { q, kind })).map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          description: p.description,
          media: p.mediaCount,
          editingProjects: p.compositionCount,
          places: p.places.map((x) => x.name),
        })),
    })
    ctx.mcp.tool({
      name: 'projects_create',
      description:
        'Create a project. kind "brand" makes a brand kit: upload its files (or one .zip of the kit) into it and ' +
        'Greenlit sorts them into logos, colours, fonts, graphics, templates, looks and guidelines.',
      input: {
        name: z.string(),
        description: z.string().optional(),
        kind: z.enum(['project', 'brand']).optional(),
      },
      access: 'projects.manage',
      handler: ({ name, description, kind }, { actor }) =>
        svc.create({ kind: kind ?? 'project', name, description: description ?? '', color: null }, actor),
    })
    ctx.mcp.tool({
      name: 'projects_update',
      description: 'Rename a project, change its description, archive it.',
      input: {
        id: z.uuid(),
        name: z.string().optional(),
        description: z.string().optional(),
        archived: z.boolean().optional(),
      },
      access: 'projects.manage',
      handler: ({ id, ...patch }, { actor }) => svc.update(id, patch, actor),
    })
  },
})
