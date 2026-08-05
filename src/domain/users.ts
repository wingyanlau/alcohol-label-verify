/**
 * The people this deployment recognises, and what each may do (design §19.5).
 *
 * Names run through the whole record — who proposed a rule, who enacted it, who
 * decided a submission — and every one of them was a free string. A free string
 * cannot be checked: a typo, a different capitalisation and a person who does
 * not exist were all indistinguishable from a real approval.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT AUTHENTICATION, AND THE DIFFERENCE MATTERS
 *
 * It says who is recognised and what they are entitled to do. It does not
 * verify that whoever typed a name is that person — D14 leaves the prototype
 * unauthenticated, and no registry fixes that. What it does buy is that an
 * unrecognised name is now a refusal rather than a record, and that proposing a
 * rule and enacting one are different entitlements rather than the same string
 * in two fields.
 */

import raw from '../../config/users.json' with { type: 'json' }

/**
 * What a person is entitled to do.
 *
 * `policy-author` and `policy-approver` are deliberately separate. A proposal
 * signed off by the person who made it is not a review, and D27 asks for a
 * review.
 */
export type UserRole = 'compliance-agent' | 'policy-approver' | 'policy-author' | 'administrator'

export interface RegisteredUser {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly roles: readonly UserRole[]
}

const users: readonly RegisteredUser[] = (raw as { users: RegisteredUser[] }).users

/** Everyone recognised, for a screen that needs to show the register. */
export function registeredUsers(): readonly RegisteredUser[] {
  return users
}

/**
 * The person a recorded name refers to, or null.
 *
 * Matched on the exact name as stored. Deliberately not fuzzy: a near-match
 * silently resolving to somebody would be worse than not resolving at all,
 * because the whole value here is that the name means a specific person.
 */
export function userByName(name: string): RegisteredUser | null {
  const wanted = name.trim()
  return users.find((u) => u.name === wanted) ?? null
}

/** Whether a recorded name belongs to somebody holding a given entitlement. */
export function userMay(name: string, role: UserRole): boolean {
  return userByName(name)?.roles.includes(role) ?? false
}

/**
 * What a role is called on screen.
 *
 * Derived from the role rather than from the free-text title, because the role
 * is the thing that matters where a name appears: what this person is entitled
 * to do here. Length of service and which filings somebody handles are colour
 * from the stakeholder register — they belong in `source`, not in a dropdown a
 * reviewer is scanning.
 */
const ROLE_LABEL: Readonly<Record<UserRole, string>> = {
  'compliance-agent': 'Compliance agent',
  'policy-approver': 'Policy approver',
  'policy-author': 'Policy author',
  administrator: 'Administrator',
}

/** The role a person is acting in, for display. Their first, where several. */
export function roleLabelFor(user: RegisteredUser): string {
  const first = user.roles[0]
  return first === undefined ? 'No role' : ROLE_LABEL[first]
}

/** How a screen should render a name: the person, and what they are here. */
export function describeUser(name: string): string {
  const user = userByName(name)
  return user === null ? `${name} (not in the register)` : `${user.name} — ${roleLabelFor(user)}`
}
