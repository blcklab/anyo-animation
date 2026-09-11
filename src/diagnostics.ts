import type { AnimationDiagnostic, AnimationDiagnosticCode } from './types.js'

export function createAnimationDiagnostic(
  severity: AnimationDiagnostic['severity'],
  code: AnimationDiagnosticCode,
  message: string,
  entityId?: string,
  details?: Readonly<Record<string, unknown>>,
): AnimationDiagnostic {
  return Object.freeze({
    severity,
    code,
    message,
    ...(entityId ? { entityId } : {}),
    ...(details ? { details: Object.freeze({ ...details }) } : {}),
  })
}
