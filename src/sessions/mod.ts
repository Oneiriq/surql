/**
 * Multiple-session support module.
 *
 * Exposes the {@link Session} wrapper and its supporting types. Obtain a session
 * via `client.newSession()` rather than constructing it directly.
 */

export { Session, SessionUnsupportedError, type UseTarget } from './session.ts'
