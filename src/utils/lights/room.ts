/**
 * Jason's bedroom from above (windows at the top), for the light show editor's room map.
 * Coordinates are in a 100 × 120 plan. Bulbs are matched by Bluetooth name; planned lamps
 * (no smart bulb yet) have none and are drawn as dashed outlines.
 */
export interface RoomLight {
  /** Bluetooth name, or null for a planned lamp */
  name: string | null
  label: string
  where: string
  x: number
  y: number
  /** How far its light reaches on the map */
  reach: number
  /** Which side of the dot its label goes */
  labelSide?: 'below' | 'right' | 'left'
}

export const PLAN_W = 100
export const PLAN_H = 120

export const ROOM_LIGHTS: RoomLight[] = [
  { name: 'ihoment_H6008_3B85', label: 'Top', where: 'Arc lamp by the desk', x: 19, y: 36, reach: 30 },
  { name: 'ihoment_H6008_A9B9', label: 'Middle', where: 'Arc lamp by the desk', x: 11, y: 42, reach: 28 },
  { name: 'ihoment_H6008_7FCD', label: 'Bottom', where: 'Arc lamp by the desk', x: 27, y: 46, reach: 26 },
  { name: 'ihoment_H6008_B597', label: 'Fan 1', where: 'Ceiling fan', x: 44, y: 62, reach: 55 },
  { name: 'ihoment_H6006_9075', label: 'Fan 2', where: 'Ceiling fan', x: 56, y: 62, reach: 55 },
  { name: 'ihoment_H6006_BC87', label: 'Hall', where: 'Hallway ceiling', x: 82, y: 113, reach: 22 },
  { name: null, label: 'Dresser lamp', where: 'Lamp on the dresser (no smart bulb yet)', x: 10.5, y: 79, reach: 30, labelSide: 'right' },
  { name: null, label: 'Bookshelf lamp', where: 'Floor lamp by the bookshelf (no smart bulb yet)', x: 90, y: 46, reach: 30, labelSide: 'left' },
]

/** Walls, windows and furniture as SVG for the 100 × 120 plan */
export const PLAN_SVG = `
  <path class="wall" d="M62 118 L62 96 L40 96 L40 104 L12 104 L12 96 L6 96 L6 29.8 L31.8 4 L68.2 4 L94 29.8 L94 96 L78 96 L78 118" />
  <path class="win" d="M33.3 4 L66.7 4 M7.1 28.7 L30.7 5.1 M69.3 5.1 L92.9 28.7" />
  <rect class="furn" x="36" y="6" width="28" height="38" rx="2" /><text x="45.5" y="27">Bed</text>
  <rect class="furn" x="6" y="38" width="11" height="30" rx="1" /><text x="7.5" y="55">Desk</text>
  <rect class="furn" x="6" y="72" width="9" height="14" rx="1" /><text x="6.5" y="89.5" style="font-size:2.4px">Dresser</text>
  <rect class="furn" x="87" y="52" width="7" height="22" rx="1" /><text x="84.5" y="78" style="font-size:2.6px">Books</text>
  <rect class="furn" x="44" y="91" width="14" height="4" rx="1" /><text x="44" y="89" style="font-size:2.6px">Console</text>
  <text x="20" y="101.5">Closet</text>
  <circle class="fan" cx="50" cy="62" r="9" /><path class="fan" d="M41 62 L59 62 M50 53 L50 71" />
  <text x="66" y="114">Hall</text>
`
