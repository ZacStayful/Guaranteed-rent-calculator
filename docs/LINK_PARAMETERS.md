# Link parameters, lead source and test leads

The website forms (and ads and emails) can send people to the calculator with their details already in the link,
so they never type them twice, and with where they came from, so every lead can be traced to its page and
campaign. Added 2026-10-16 (website build plan, batch 1). The code is `src/lib/linkParams.ts`.

## Example

```
https://guaranteedrent.stayful.co.uk/?address=12 High Street, Leeds LS1 4AB&email=jane@example.co.uk&bedrooms=2&rent=1200&utm_source=google&utm_medium=organic&from=/guaranteed-rent-leeds
```

The form opens with the address already picked (the green tick row with its Change button), the email,
bedrooms and desired rent filled in. Nothing is submitted: the visitor checks the details and presses the button.

## Details the form is filled with

All optional. Anything that does not pass the check is ignored, never guessed at.

| Parameter | What it fills | Accepted |
|---|---|---|
| `address` | Property address | Up to 200 characters. A UK postcode inside it is taken out and used as the postcode. |
| `postcode` | Postcode | A full UK postcode, any case, with or without the space. Wins over one inside `address`. |
| `email` | Email | Looks like an email, up to 254 characters. |
| `bedrooms` | Bedrooms | Whole number, 0 to 5. Max guests is worked out from it as usual. |
| `bathrooms` | Bathrooms | Whole number, 1 to 5. |
| `type` | Property type | Flat, Terraced, Semi-detached or Detached (any case; "semi detached" also works). |
| `rent` | Desired monthly rent | Pounds, more than 0 and up to 50,000. "1200", "£1,200" and "1200.50" all work (rounded to whole pounds). Every guaranteed rent form on the website asks for it. |

With both a street and a postcode, the address shows as already picked. With only one of them, the manual
address fields open with what was given, so the visitor can add the rest.

A demo link (`?demo=...`) loads its demo figures and ignores all of the above.

Remember to encode the link properly when building it in code (for example `encodeURIComponent` in JavaScript,
or n8n's URL encoding), especially the address and email.

## Where the lead came from

| Parameter | Meaning |
|---|---|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | The usual campaign tags. Up to 150 characters each. |
| `from` | The stayful.co.uk page that sent them, as a path (`/guaranteed-rent-leeds`) or a full stayful.co.uk address. Anything from another site is dropped. |

The calculator keeps these for the rest of the visit (in the browser's session storage, so a reload keeps them),
sends them with the analysis, and the server checks them again. When the analysis finds the lead in Monday
(Guaranteed rent leads board), they are written to these columns:

| Field | Monday column | Column id |
|---|---|---|
| `from` | Source page | `text_mm86x9r1` |
| `utm_source` | UTM source | `text_mm86hvgw` |
| `utm_medium` | UTM medium | `text_mm86dwx6` |
| `utm_campaign` | UTM campaign | `text_mm86a00f` |
| `utm_content` | UTM content | `text_mm8632zb` |
| `utm_term` | UTM term | `text_mm86s50c` |

Only empty cells are filled, so the first source a lead came from is kept (the website form that created the
lead writes the same columns). This is a separate Monday update from the figures, so a problem with these
columns can never stop the figures or the PDF landing. The existing "Lead source" column is not touched. The
calculator still never creates a lead: with no matching lead, nothing is written, exactly as before.

## Conversion events

When an analysis completes, the Meta pixel's `Lead` event fires once (with an event id). If Google Analytics is
on the page (it is not yet; that comes with the cookie consent work), a `generate_lead` event fires too. The
pixel only loads when `NEXT_PUBLIC_META_PIXEL_ID` is set (the same pixel as the management calculator).

This calculator never offers a way to book a call. Nothing here changes that.

## Test leads

Use an email ending **`@test.stayful.co.uk`** (for example `zac@test.stayful.co.uk`) to run the calculator end
to end without touching anything real:

- the analysis runs and shows in full, and the PDF can be downloaded;
- no report is stored in Supabase;
- nothing is read from or written to Monday (no lead lookup, no figures, no status, no PDF, no use count);
- the free-analysis limit does not apply;
- no Meta pixel or Google Analytics conversion event fires;
- the form shows "Test email: this run will not be saved to Monday."

To make **every** run of the form a test run on a deployment (for example Vercel previews), set
`CALCULATOR_TEST_MODE=1` on that deployment's environment. That stops the Monday and Supabase writes; the browser
does not know about it, so use a test email as well if you also want the pixel to stay quiet. The admin bulk upload
is not affected (it has its own `MONDAY_DRY_RUN`).

When Resend sign-ups are added to the calculator (build plan batch 3), they must skip test emails too
(`isTestLead` in `src/lib/linkParams.ts`).
