import { afterEach, describe, expect, it } from 'vitest'
import { backendOrder, gpuPreference } from './gpu.ts'

describe('graphics card backends', () => {
  const saved = process.env.GREENLIT_GPU
  afterEach(() => {
    if (saved === undefined) delete process.env.GREENLIT_GPU
    else process.env.GREENLIT_GPU = saved
  })

  it('stays on the processor when the card is turned off', () => {
    process.env.GREENLIT_GPU = 'off'
    expect(gpuPreference()).toBe('off')
    expect(backendOrder()).toEqual(['cpu'])
    process.env.GREENLIT_GPU = 'cpu'
    expect(backendOrder()).toEqual(['cpu'])
  })

  it('forces one backend, with the processor behind it', () => {
    process.env.GREENLIT_GPU = 'CUDA'
    expect(backendOrder()).toEqual(['cuda', 'cpu'])
    process.env.GREENLIT_GPU = 'webgpu'
    expect(backendOrder()).toEqual(['webgpu', 'cpu'])
  })

  it('always ends with the processor on auto', () => {
    delete process.env.GREENLIT_GPU
    expect(gpuPreference()).toBe('auto')
    expect(backendOrder().at(-1)).toBe('cpu')
  })
})
