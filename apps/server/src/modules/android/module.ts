import sharp from 'sharp'
import { z } from 'zod'
import { can } from '../../core/actor.ts'
import { HttpError } from '../../core/errors.ts'
import { Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { Device, KEYS, type Key } from './device.ts'

export interface AndroidService {
  device: Device
}
declare module '../../core/services.ts' {
  interface Services {
    android: AndroidService
  }
}

const tags = ['Android device']

const DeviceStatusView = z.object({
  configured: z.boolean(),
  online: z.boolean(),
  booted: z.boolean(),
  serial: z.string().nullable(),
  model: z.string().nullable(),
  android: z.string().nullable(),
  screen: z.object({ width: z.number(), height: z.number() }).nullable(),
  message: z.string().nullable(),
})

const Input = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tap'), x: z.number().min(0), y: z.number().min(0) }),
  z.object({
    type: z.literal('swipe'),
    x1: z.number().min(0),
    y1: z.number().min(0),
    x2: z.number().min(0),
    y2: z.number().min(0),
    ms: z.number().int().min(10).max(5000).default(250),
  }),
  z.object({ type: z.literal('key'), key: z.enum(Object.keys(KEYS) as [Key, ...Key[]]) }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(500) }),
])

export default defineModule({
  id: 'android',
  name: 'Android device',
  description:
    'Greenlit’s own Android device (an emulator in Docker) for what only a platform’s Android app does, shown in Settings so apps can be signed in on it.',
  dependsOn: ['users'],
  permissions: {
    'android.manage': {
      description: 'See and use Greenlit’s Android device (sign in to apps on it)',
      roles: [],
    },
  },
  setup(ctx) {
    const device = new Device(ctx.config.androidAdb, ctx.config.adb)
    ctx.services.provide('android', { device })

    route(ctx.api, {
      method: 'get',
      path: '/android',
      summary: 'Whether Greenlit’s Android device is set up, running and started',
      tags,
      access: 'android.manage',
      response: DeviceStatusView,
      handler: () => device.status(),
    })

    // The screen, as a picture (the device view in Settings asks for it a few times a second): a small JPEG, which
    // travels about five times faster than the device's own PNG; taps are sent in device pixels anyway.
    ctx.api.get('/android/screen', async (c) => {
      const actor = c.get('actor')
      if (!can(actor, 'android.manage')) throw new HttpError(actor ? 'forbidden' : 'unauthenticated')
      try {
        const frame = await device.screen()
        const jpeg = await sharp(frame.pixels, {
          raw: { width: frame.width, height: frame.height, channels: 4 },
        })
          .resize({ width: 720 })
          .jpeg({ quality: 72 })
          .toBuffer()
        return new Response(new Uint8Array(jpeg), {
          headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
        })
      } catch (err) {
        throw new HttpError('unavailable', (err as Error).message.split('\n')[0])
      }
    })

    route(ctx.api, {
      method: 'post',
      path: '/android/input',
      summary: 'A tap, swipe, key or typed text on the device’s screen (device pixels)',
      description: 'Typed text goes straight to the device and is never logged (it may be a password).',
      tags,
      access: 'android.manage',
      body: Input,
      response: Ok,
      handler: async ({ body }) => {
        if (body.type === 'tap') await device.tap(body.x, body.y)
        else if (body.type === 'swipe') await device.swipe(body.x1, body.y1, body.x2, body.y2, body.ms)
        else if (body.type === 'key') await device.key(body.key)
        else await device.text(body.text)
        return { ok: true as const }
      },
    })
  },
})
