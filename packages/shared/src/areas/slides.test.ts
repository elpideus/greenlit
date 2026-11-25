import { describe, expect, it } from 'vitest'
import { slidesOrder, slidesTitle } from './media.ts'

describe('slidesTitle', () => {
  it('keeps what the pages have in common, without numbers and separators', () => {
    expect(slidesTitle(['Trullo Today Post - 1', 'Trullo Today Post - 2', 'Trullo Today Post - 3'])).toBe(
      'Trullo Today Post',
    )
    expect(slidesTitle(['Pool 01', 'Pool 02'])).toBe('Pool')
    expect(slidesTitle(['Living Area · page 1', 'Living Area · page 2'])).toBe('Living Area')
  })
  it('leaves out a closing page named otherwise', () => {
    expect(slidesTitle(['Olive Grove Post - 1', 'Olive Grove Post - 2', 'Key Facts Post'])).toBe(
      'Olive Grove Post',
    )
    expect(slidesTitle(['Cover', 'At Dusk 1', 'At Dusk 2', 'At Dusk 3'])).toBe('At Dusk')
  })
  it('gives nothing when the titles share nothing', () => {
    expect(slidesTitle(['Kitchen', 'Garden', 'Bedroom'])).toBe('')
    expect(slidesTitle([])).toBe('')
  })
  it('uses the only title there is', () => {
    expect(slidesTitle(['Key Facts Post'])).toBe('Key Facts Post')
  })
})

describe('slidesOrder', () => {
  const at = (title: string, minute: number) => ({
    title,
    createdAt: `2026-11-24T23:${String(minute).padStart(2, '0')}:00Z`,
  })
  it('puts numbered pages in number order and the odd one last', () => {
    const list = [
      at('Key Facts Post', 1),
      at('Pool Post - 10', 2),
      at('Pool Post - 2', 3),
      at('Pool Post - 1', 4),
    ]
    expect(slidesOrder(list).map((m) => m.title)).toEqual([
      'Pool Post - 1',
      'Pool Post - 2',
      'Pool Post - 10',
      'Key Facts Post',
    ])
  })
  it('keeps named pages in the order they were added', () => {
    const list = [
      at('Key Facts Post', 1),
      at('Project Pool Post - Cover', 2),
      at('Project Pool Post - View over the Property', 4),
      at("Project Pool Post - Bird's Eye View", 5),
      at('Project Pool Post - Trullo, Lamia & Pool', 3),
    ]
    expect(slidesOrder(list).map((m) => m.title)).toEqual([
      'Project Pool Post - Cover',
      'Project Pool Post - Trullo, Lamia & Pool',
      'Project Pool Post - View over the Property',
      "Project Pool Post - Bird's Eye View",
      'Key Facts Post',
    ])
  })
  it('keeps the order they were added without a shared name', () => {
    const list = [at('Garden', 3), at('Kitchen', 1), at('Bedroom', 2)]
    expect(slidesOrder(list).map((m) => m.title)).toEqual(['Kitchen', 'Bedroom', 'Garden'])
  })
})
