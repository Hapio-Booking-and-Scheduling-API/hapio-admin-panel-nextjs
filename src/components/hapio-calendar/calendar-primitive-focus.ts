'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import type { CalendarStrings } from '@hapio/calendar-react'
import { useEffect, useState, useSyncExternalStore } from 'react'

// Turning off a primitive's own focus restore in base-agnostic files (BASES.md rules 4 and 8):
// where a hook restores focus itself (the "+N more" popover, the event actions' menu and dialog),
// the app's Popover, DropdownMenu or Dialog must not move focus again when its content unmounts
// after its exit animation. Each base has its own prop for that, and each base's prop reaches the
// DOM in the other, so the hook below tells the bases apart first. Portalled out of the calendar's
// root, those primitives also take its language (`calendarLanguage`) beside its direction.

/**
 * The `lang` of the calendar's portalled parts (the menu, the popover, the dialogs; BASES.md rule
 * 6), as its root has it: the language of its strings (`strings.lang`), else the built-in
 * English's. Never the locale's: English strings under a Hebrew `locale` are English text.
 */
export function calendarLanguage(strings: CalendarStrings): string {
  return strings.lang ?? 'en'
}

/**
 * Which base the app's shadcn components are built on (BASES.md rule 8). Base UI's roots fill an
 * `actionsRef` when they mount; Radix's roots take no such prop and ignore it (a root renders no
 * element, so nothing reaches the DOM). One app has one base, so the answer is kept for the page.
 */
type PrimitiveBase = 'radix' | 'base' | null

let knownBase: PrimitiveBase = null
const baseListeners = new Set<() => void>()

/** Records the base once (the first root to mount tells), and re-renders whoever waits for it. */
function learnBase(base: 'radix' | 'base'): void {
  if (knownBase !== null) return
  knownBase = base
  for (const listener of baseListeners) listener()
}

function subscribeBase(listener: () => void): () => void {
  baseListeners.add(listener)
  return () => {
    baseListeners.delete(listener)
  }
}

function currentBase(): PrimitiveBase {
  return knownBase
}

function serverBase(): PrimitiveBase {
  return null
}

/** Radix: `onCloseAutoFocus` prevented (the content's focus restore). */
const RADIX_FOCUS_OFF = { onCloseAutoFocus: (event: Event) => event.preventDefault() }
/** Base UI: `finalFocus={false}` (the popup's focus restore). */
const BASE_FOCUS_OFF = { finalFocus: false }
/** Before the base is known, and on a root once it is: nothing. */
const NO_PROPS = {}

/** What `usePrimitiveFocusOff` returns. */
export interface PrimitiveFocusOff {
  /**
   * Spread on the root (`Popover`, `DropdownMenu`, `Dialog`): the probe that tells the bases apart
   * while the base is not known yet (typed as no props: Radix's roots have none of it).
   */
  readonly rootProps: object
  /**
   * Spread on `PopoverContent`, `DropdownMenuContent` or `DialogContent`: the prop that turns the
   * primitive's own focus restore off in the app's base, never the other base's (each would put
   * the other's on the DOM); typed as no props.
   */
  readonly contentProps: object
}

/**
 * Turns off the focus restore of the app's popover, menu or dialog primitive, whichever base it
 * is: the calendar's hooks restore focus themselves (BASES.md rules 4 and 8). The first root of a
 * page learns the base when it mounts, a render before any close.
 */
export function usePrimitiveFocusOff(): PrimitiveFocusOff {
  const base = useSyncExternalStore(subscribeBase, currentBase, serverBase)
  const [probe] = useState(() => ({ current: null as unknown }))
  useEffect(() => {
    learnBase(probe.current === null ? 'radix' : 'base')
  }, [probe])
  return {
    rootProps: base === null ? { actionsRef: probe } : NO_PROPS,
    contentProps: base === 'radix' ? RADIX_FOCUS_OFF : base === 'base' ? BASE_FOCUS_OFF : NO_PROPS,
  }
}
