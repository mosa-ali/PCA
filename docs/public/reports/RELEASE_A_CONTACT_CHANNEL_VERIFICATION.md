# Release A — Contact Channel Verification

**Status: `CONTACT_CHANNEL = NOT_READY`** — aliases exist, delivery is unproven.

```
SUPPORT_ALIAS_CONFIGURED  = YES        SUPPORT_INBOUND_VERIFIED  = NOT_TESTED
PRIVACY_ALIAS_CONFIGURED  = YES        PRIVACY_INBOUND_VERIFIED  = NOT_TESTED
SECURITY_ALIAS_CONFIGURED = YES        SECURITY_INBOUND_VERIFIED = NOT_TESTED
ADMIN_ALIAS_CONFIGURED    = YES        ADMIN_INBOUND_VERIFIED    = NOT_TESTED
PUBLIC_REPLY_IDENTITY     = NOT_TESTED
```

---

## 1. What is actually known

The owner has configured four forwarding aliases on `pcasafe.com`:
`support@`, `privacy@`, `security@`, `admin@`. All forward to a single
owner-monitored destination.

That is **owner evidence of configuration**, and it is recorded as exactly that:
`EMAIL_ALIAS_CONFIGURATION = OWNER_EVIDENCE_PRESENT`. It is not evidence of delivery.
The forwarding destination is deliberately not recorded in this repository, in any
report, in any rendered page, or in any log.

A forwarding rule can exist and still not deliver: the domain may have no SPF or DMARC
alignment for forwarded mail, the receiving provider may silently junk it, a loop may
form, or the alias may accept and blackhole. None of those are visible from the
configuration screen. Only a message sent from outside the domain and observed
arriving proves the channel.

---

## 2. Why this blocks the Contact page

`/contact/` currently states plainly that PCA cannot receive messages yet. That
wording was added during PUBLIC-14, which found the page had previously routed people
to a "Report security concern" control that existed nowhere — an invitation to
disclose a security issue into a void.

That wording must **not** be changed to a working-contact claim until inbound delivery
is proven. Publishing an address is a promise that someone will read what is sent to
it; publishing `security@` in particular invites a stranger to disclose a
vulnerability and trust that it lands somewhere.

The activation order is therefore:

| Address | May appear in | Only after |
|---|---|---|
| `support@pcasafe.com` | Contact page | `SUPPORT_INBOUND_VERIFIED = PASS` |
| `privacy@pcasafe.com` | Privacy Policy, Privacy & Safety | `PRIVACY_INBOUND_VERIFIED = PASS` |
| `security@pcasafe.com` | Contact, Privacy & Safety, security disclosure text | `SECURITY_INBOUND_VERIFIED = PASS` |
| `admin@pcasafe.com` | **nowhere public** | — operational alias; not proposed as public copy |

---

## 3. The test procedure

These are manual tests. They require sending real mail from a real external account
and reading a mailbox, and I have neither an external mail account nor access to the
owner's mailbox — so I have not run them, and no result below is filled in. **Do not
record a result that was not observed.**

Run each test from an account on a domain that is **not** `pcasafe.com` (a personal
Gmail/Outlook account is fine, and using two different providers is better because
their junk filtering differs).

### Per-alias tests

For each of `support@`, `privacy@`, `security@` (and optionally `admin@`):

| # | Test | Record |
|---|---|---|
| T-1 | Send a plain-text message from an external account with a distinctive subject. | sent at (UTC) |
| T-2 | Confirm it arrives at the monitored destination. | arrived / did not arrive |
| T-3 | Confirm the **original sender** is preserved and visible (not rewritten to a system address). | preserved / rewritten to what |
| T-4 | Confirm the subject and full body arrive intact, including any Arabic text. | intact / altered |
| T-5 | Confirm it landed in the inbox, not junk/spam. | inbox / junk |
| T-6 | Record the delivery delay. | seconds/minutes |
| T-7 | Send a message with an attachment and one with Arabic subject + body. | delivered / stripped / mangled |
| T-8 | Confirm no forwarding loop (the message does not arrive repeatedly, and no bounce storm). | clean / loop observed |
| T-9 | Confirm the four aliases are distinguishable at the destination — i.e. it is possible to tell a `privacy@` message from a `support@` one **without opening it**. | distinguishable how |

### Reply-identity tests — the part most likely to fail

| # | Test | Record |
|---|---|---|
| R-1 | Reply to the forwarded message from the monitored mailbox. | — |
| R-2 | From what address does the reply **actually arrive** at the external sender? | exact From shown |
| R-3 | Does the reply disclose the owner's private mailbox address? | yes / no |
| R-4 | Does the reply pass SPF/DKIM/DMARC for the domain it claims to be from? | pass / fail |
| R-5 | Can the mailbox send **as** `support@pcasafe.com` (verified send-as), or only forward-and-reply-as-self? | send-as / forward only |

---

## 4. How to classify the outcome

**Forwarding is not send-as.** These are two independent capabilities and must be
recorded separately:

- Inbound works, replies come from the PCA address, SPF/DKIM/DMARC align
  → `INBOUND_CONTACT = PASS`, `PUBLIC_REPLY_IDENTITY = PASS`.
- Inbound works, but a reply exposes the owner's private address, or fails
  authentication, or arrives from a personal domain
  → `INBOUND_CONTACT = PASS`, `PUBLIC_REPLY_IDENTITY = NOT_READY`.
  The alias may then be published **only** if the owner explicitly accepts an
  inbound-only model, and the site says so — for example that PCA reads messages at
  this address and will reply from a PCA address once mail is fully configured. Do not
  publish an address that will answer from somewhere else without saying so.
- Mail does not arrive, or lands in junk
  → `INBOUND_CONTACT = FAIL`. Nothing is published. Fix SPF/DKIM/DMARC first.

`CONTACT_CHANNEL = PASS` requires `SUPPORT_INBOUND_VERIFIED = PASS` **and** a settled
`PUBLIC_REPLY_IDENTITY` (either `PASS`, or `NOT_READY` with an explicit owner-approved
inbound-only model reflected in the published copy).

`SECURITY_CONTACT_CHANNEL = PASS` requires `SECURITY_INBOUND_VERIFIED = PASS`.

---

## 5. Recommendation

Forwarding aliases are the right thing for launch traffic volume, but they are a
half-channel: they receive and they cannot speak. Before public support
correspondence begins, one of the following should be in place:

1. **Verified send-as** on the monitored mailbox for each published `pcasafe.com`
   address, with SPF, DKIM and DMARC aligned for the domain — the smallest change
   that closes `PUBLIC_REPLY_IDENTITY`; or
2. **Real mailboxes** on `pcasafe.com` through a mail provider, with the monitored
   personal mailbox kept entirely out of the correspondence path.

Option 2 is the durable answer, because it also survives the owner's personal mailbox
changing, and it keeps a private address out of a correspondence chain that may
include distressed parents and security researchers.

Note that DMARC also affects a second thing this programme will need later:
transactional email for account verification. That is Release B and is separately
blocked — `PPR1R-D003` records that no email provider is configured and production
signup returns 202 without sending anything.

---

## 6. Results

**Not run.** No test in §3 has been executed by this session. This table stays empty
until the owner runs the tests and supplies the observations.

| Alias | Inbound | Sender preserved | Junk? | Delay | Reply From | Private address exposed? | Verdict |
|---|---|---|---|---|---|---|---|
| `support@pcasafe.com` | | | | | | | `NOT_TESTED` |
| `privacy@pcasafe.com` | | | | | | | `NOT_TESTED` |
| `security@pcasafe.com` | | | | | | | `NOT_TESTED` |
| `admin@pcasafe.com` | | | | | | | `NOT_TESTED` |

Until this table is filled in from observation, `/contact/` keeps its current honest
wording and no address is published.
