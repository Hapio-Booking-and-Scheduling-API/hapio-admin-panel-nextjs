/** Both timestamps carry the location's offset, so their date parts are local dates. */
export function sameWallDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10)
}
