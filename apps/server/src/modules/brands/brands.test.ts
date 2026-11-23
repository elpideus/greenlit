import { kitRoot, placeBrandFile } from '@greenlit/shared'
import { describe, expect, it } from 'vitest'
import { mergeColors, mergeFonts, parseAse, parsePalette } from './palettes.ts'
import { firstParagraph, pickLogo } from './service.ts'

describe('placing a kit’s files', () => {
  const cases: [string, string, string][] = [
    ['00 Anteprime/01 — Copertina.png', 'guidelines', 'Anteprime'],
    ['01 Loghi/Costruzioni GEM/GEM-Costruzioni-bianco.svg', 'logos', 'Costruzioni GEM'],
    [
      '01 Loghi/Studio Associato GEM/Vettoriale (SVG)/x.svg',
      'logos',
      'Studio Associato GEM › Vettoriale (SVG)',
    ],
    ['02 Colori/GEM.ase', 'colors', ''],
    ['02 Colori/GEM-palette.png', 'colors', ''],
    ['03 Font/Cinzel/static/Cinzel-Bold.ttf', 'fonts', 'Cinzel › static'],
    ['03 Font/Jost/OFL.txt', 'fonts', 'Jost'],
    ['04 Elementi grafici/Icone/bianco/gem-icona-web.svg', 'graphics', 'Icone › bianco'],
    ['05 Template/Social/Post 01.png', 'templates', 'Social'],
    ['05 Template/Stampa/Anteprime/Vetrina A3.png', 'templates', 'Stampa › Anteprime'],
    ['06 LUT/GEM_Luce.cube', 'looks', ''],
    ['07 Firma email/firma-email.html', 'files', 'Firma email'],
    ['08 Sorgenti (per rigenerare il kit)/brand.py', 'files', 'Sorgenti (per rigenerare il kit)'],
    ['09 Sfondi/GEM-sfondo-telefono-arco.png', 'graphics', 'Sfondi'],
    ['GEM - Linee guida del marchio.pdf', 'guidelines', ''],
    ['GEM Brand Kit.figcraft', 'templates', ''],
    ['README.md', 'files', ''],
    // English kits, and files whose folder says nothing
    ['Brand/Logos/Primary/logo-white.svg', 'logos', 'Primary'],
    ['Assets/Fonts/Inter.otf', 'fonts', ''],
    ['Colours/brand.gpl', 'colors', ''],
    ['misc/logo-mark.png', 'logos', 'misc'],
    ['Misc/photo.jpg', 'graphics', 'Misc'],
    // a font in the logos folder still goes to Fonts
    ['Logos/Some Font.ttf', 'fonts', 'Logos'],
  ]
  for (const [path, section, group] of cases)
    it(path, () => expect(placeBrandFile(path)).toEqual({ section, group }))

  it('leaves out the folder a whole kit sits in, not one that names a section', () => {
    expect(kitRoot(['Branding/01 Loghi/a.svg', 'Branding/README.md'])).toBe('Branding')
    expect(kitRoot(['Logos/a.svg', 'Logos/b.svg'])).toBe('')
    expect(kitRoot(['a.svg', 'Branding/b.svg'])).toBe('')
  })
})

describe('reading palettes', () => {
  const tokens = Buffer.from(
    JSON.stringify({
      color: {
        'dark-gray': {
          value: '#141414',
          cmyk_indicativo: 'C73 M67 Y65 K80',
          ruolo: 'Background',
          tipo: 'core',
        },
        pietra: { value: '#b49b74', ruolo: 'Accent, on dark only', tipo: 'accento' },
      },
      font: {
        display: { family: 'Cinzel', weight: 700, case: 'uppercase', letterSpacing: '0.03em' },
        text: { family: 'Jost', weights: [300, 400, 500] },
      },
    }),
  )

  it('reads design tokens: values, print values, usage, groups and fonts', () => {
    const r = parsePalette('gem-tokens.json', tokens)
    expect(r.colors).toEqual([
      { name: 'Dark Gray', hex: '#141414', cmyk: 'C73 M67 Y65 K80', usage: 'Background', group: 'core' },
      { name: 'Pietra', hex: '#B49B74', cmyk: null, usage: 'Accent, on dark only', group: 'accento' },
    ])
    expect(r.fonts).toEqual([
      { family: 'Cinzel', role: 'display', weights: [700], uppercase: true, letterSpacing: 0.03, usage: '' },
      {
        family: 'Jost',
        role: 'text',
        weights: [300, 400, 500],
        uppercase: false,
        letterSpacing: null,
        usage: '',
      },
    ])
  })

  it('reads W3C tokens and plain name → colour maps', () => {
    const w3c = { brand: { primary: { $type: 'color', $value: '#ff0000', $description: 'Buttons' } } }
    expect(parsePalette('tokens.json', Buffer.from(JSON.stringify(w3c))).colors).toEqual([
      { name: 'Primary', hex: '#FF0000', cmyk: null, usage: 'Buttons', group: 'Brand' },
    ])
    expect(
      parsePalette('colors.json', Buffer.from('{"ink":"#000","paper":"rgb(255, 250, 240)"}')).colors,
    ).toEqual([
      { name: 'Ink', hex: '#000000', cmyk: null, usage: '', group: '' },
      { name: 'Paper', hex: '#FFFAF0', cmyk: null, usage: '', group: '' },
    ])
  })

  it('reads GIMP palettes', () => {
    const gpl = 'GIMP Palette\nName: GEM\n#\n 20  20  20\tGEM Dark Gray\n180 155 116\tPietra\n'
    expect(parsePalette('GEM.gpl', Buffer.from(gpl)).colors.map((c) => [c.name, c.hex])).toEqual([
      ['GEM Dark Gray', '#141414'],
      ['Pietra', '#B49B74'],
    ])
  })

  it('reads CSS custom properties without their shared prefix, comments as usage', () => {
    const css = `:root {\n  --gem-dark-gray: #141414; /* Background */\n  --gem-pietra: #B49B74;\n  --gem-font-display: 'Cinzel', serif; /* always UPPERCASE */\n}`
    const r = parsePalette('gem.css', Buffer.from(css))
    expect(r.colors.map((c) => [c.name, c.hex, c.usage])).toEqual([
      ['Dark Gray', '#141414', 'Background'],
      ['Pietra', '#B49B74', ''],
    ])
    expect(r.fonts[0]).toMatchObject({ family: 'Cinzel', role: 'display' })
  })

  it('reads Adobe Swatch Exchange files, groups included', () => {
    const name = (s: string) => {
      const b = Buffer.alloc(2 + (s.length + 1) * 2)
      b.writeUInt16BE(s.length + 1, 0)
      for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), 2 + i * 2)
      return b
    }
    const block = (type: number, body: Buffer) => {
      const h = Buffer.alloc(6)
      h.writeUInt16BE(type, 0)
      h.writeUInt32BE(body.length, 2)
      return Buffer.concat([h, body])
    }
    const rgb = (n: string, r: number, g: number, b: number) => {
      const v = Buffer.alloc(4 + 12 + 2)
      v.write('RGB ', 0, 'latin1')
      v.writeFloatBE(r, 4)
      v.writeFloatBE(g, 8)
      v.writeFloatBE(b, 12)
      return block(0x0001, Buffer.concat([name(n), v]))
    }
    const cmyk = (n: string, c: number, m: number, y: number, k: number) => {
      const v = Buffer.alloc(4 + 16 + 2)
      v.write('CMYK', 0, 'latin1')
      for (const [i, x] of [c, m, y, k].entries()) v.writeFloatBE(x, 4 + i * 4)
      return block(0x0001, Buffer.concat([name(n), v]))
    }
    const head = Buffer.alloc(12)
    head.write('ASEF', 0, 'latin1')
    head.writeUInt16BE(1, 4)
    head.writeUInt32BE(4, 8)
    const ase = Buffer.concat([
      head,
      block(0xc001, name('Core')),
      rgb('GEM Dark Gray', 20 / 255, 20 / 255, 20 / 255),
      block(0xc002, Buffer.alloc(0)),
      cmyk('Black', 0, 0, 0, 1),
    ])
    expect(parseAse(ase)).toEqual([
      { name: 'GEM Dark Gray', hex: '#141414', cmyk: null, usage: '', group: 'Core' },
      { name: 'Black', hex: '#000000', cmyk: 'C0 M0 Y0 K100', usage: '', group: '' },
    ])
  })

  it('joins the same colours from several files, keeping the best of each', () => {
    let colors = mergeColors([], parsePalette('gem-tokens.json', tokens).colors)
    colors = mergeColors(colors, [
      { name: 'GEM Dark Gray', hex: '#141414', cmyk: null, usage: '', group: '' },
      { name: 'Ulivo', hex: '#7E8468', cmyk: null, usage: '', group: '' },
    ])
    expect(colors.map((c) => [c.id, c.name, c.cmyk, c.group])).toEqual([
      ['dark-gray', 'GEM Dark Gray', 'C73 M67 Y65 K80', 'core'],
      ['pietra', 'Pietra', null, 'accento'],
      ['ulivo', 'Ulivo', null, ''],
    ])
    const fonts = mergeFonts(
      [],
      [
        {
          family: 'Cinzel',
          role: 'other',
          weights: [],
          uppercase: false,
          letterSpacing: null,
          usage: 'Titles',
        },
      ],
    )
    expect(
      mergeFonts(fonts, [
        {
          family: 'cinzel',
          role: 'display',
          weights: [700],
          uppercase: true,
          letterSpacing: 0.03,
          usage: '',
        },
      ]),
    ).toEqual([
      {
        family: 'Cinzel',
        role: 'display',
        weights: [700],
        uppercase: true,
        letterSpacing: 0.03,
        usage: 'Titles',
      },
    ])
  })
})

describe('the main logo', () => {
  const c = (name: string, group: string, svg: boolean, surface: 'dark' | 'light' | null) => ({
    mediaId: name,
    name,
    group,
    svg,
    surface,
    url: `/${name}`,
  })
  it('is the horizontal lockup made for the card’s background, vector first, never an original', () => {
    const cands = [
      c('logo-long-white.png', 'Originali (non modificati)', false, 'dark'),
      c('GEM-Studio-avatar-scuro.png', 'Profilo social', false, null),
      c('GEM-Studio-tempio-bianco.svg', 'Studio Associato GEM › Vettoriale (SVG)', true, 'dark'),
      c('GEM-Studio-orizzontale-nero.svg', 'Studio Associato GEM › Vettoriale (SVG)', true, 'light'),
      c('GEM-Studio-orizzontale-bianco.png', 'Studio Associato GEM', false, 'dark'),
      c('GEM-Studio-orizzontale-bianco.svg', 'Studio Associato GEM › Vettoriale (SVG)', true, 'dark'),
    ]
    expect(pickLogo(cands, 'dark')?.mediaId).toBe('GEM-Studio-orizzontale-bianco.svg')
    expect(pickLogo(cands, 'light')?.mediaId).toBe('GEM-Studio-orizzontale-nero.svg')
    expect(pickLogo([], 'dark')).toBeNull()
  })
})

describe('the kit’s description from its README', () => {
  it('is the first paragraph under the title, without Markdown', () => {
    const md =
      '# Studio Associato GEM — Brand Kit 2026\n\nIl kit del marchio per il rilancio di GEM. Due colori, due ' +
      'caratteri, pochi segni presi dalla pietra pugliese.\n**Prima di tutto**, apri il PDF.\n\n## Cosa c’è\n\n| a | b |'
    expect(firstParagraph(md)).toBe(
      'Il kit del marchio per il rilancio di GEM. Due colori, due caratteri, pochi segni presi dalla pietra ' +
        'pugliese. Prima di tutto, apri il PDF.',
    )
    expect(firstParagraph('# Title\n\n| only | a table |')).toBe('')
  })
})
