---
description: Choose the folder plans and scores live in (plansFolder in .claude/settings.json) without moving any file, or set the organization the band expects (expectOrg)
argument-hint: "[.alfred-mods|.alfred|default|expectOrg [name]]"
disable-model-invocation: true
---

The alfred-mods hooks did not answer this command, so tell the user it did nothing here. To set the plans folder by
hand, add `"alfred-mods": { "plansFolder": "<value>" }` to `.claude/settings.json`, where `<value>` is `.alfred-mods`,
`.alfred` or `default`. To make the band warn when the signed-in organization differs from the one the project expects,
add `"alfred-mods": { "expectOrg": "<name>" }` the same way.
