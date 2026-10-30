# Release notes

One file per tag, `vX.Y.Z.md`: 3 to 6 short lines, each starting with `- `, plain text for the
user. Write it on a topic branch and merge it into the release branch **before** the tag exists.
The CI copies it into the GitHub Release body between `<!-- llmb-notes -->` markers.

A **stable** release lists everything since the previous *stable* tag, betas included; a **beta**
lists only what is new since the previous tag.
