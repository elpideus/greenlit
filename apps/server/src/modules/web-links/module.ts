import { normalizeWebUrl, WebLinkPreview } from '@greenlit/shared'
import { z } from 'zod'
import { can } from '../../core/actor.ts'
import { badRequest, forbidden } from '../../core/errors.ts'
import { route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { pageTitle } from './page-title.ts'

/**
 * Web links (addresses kept on projects and media items: `webLinks` on both, saved with their PATCH). This module
 * only reads a pasted page's title, so a new link names itself.
 */
export default defineModule({
  id: 'web-links',
  name: 'Web links',
  description: 'Reads the title of a web page someone links a project or a media item to.',
  dependsOn: ['projects', 'media'],
  setup(ctx) {
    route(ctx.api, {
      method: 'post',
      path: '/web-links/preview',
      summary: "A web page's title, for a link being added (empty when the page doesn't say)",
      tags: ['Web links'],
      access: 'signed-in',
      body: z.object({ url: z.string().max(2048) }),
      response: WebLinkPreview,
      handler: async ({ actor, body }) => {
        // Only people who can add links make Greenlit fetch pages; never a share-link visitor.
        if (
          actor.kind === 'user' &&
          (actor.share || !(can(actor, 'media.edit') || can(actor, 'projects.manage')))
        )
          throw forbidden()
        const url = normalizeWebUrl(body.url)
        if (!url) throw badRequest('Not a web address (it must start with http:// or https://)')
        return { url, title: await pageTitle(url) }
      },
    })
  },
})
