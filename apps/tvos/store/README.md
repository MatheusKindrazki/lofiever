# App Store Connect handoff

The repository contains the release configuration, localized metadata, privacy text, layered tvOS artwork, and a reproducible archive/export workflow.

## App record

Use `app-store-connect.json` when creating the record. The Bundle ID must remain `com.matheuskindrazki.lofievertv`; Apple does not allow changing it after the first build is uploaded.

Select Music as the primary category and Entertainment as the secondary category. Complete the age-rating questionnaire with the app's actual content. The expected result is the lowest general-audience rating because the client contains no user-generated content, gambling, violence, or mature themes.

## Required account confirmations

Before submission, the Account Holder or Admin must:

1. Accept any pending Apple Developer agreements.
2. Confirm that the team owns or is licensed to stream every track in the production catalog, then answer Content Rights accordingly.
3. Confirm production log retention and publish App Privacy answers using `privacy-details.md`.
4. Create or allow Xcode to create an Apple Distribution certificate and a tvOS App Store Connect provisioning profile.

## Build

From `apps/tvos`:

```bash
npm ci
npm run release:archive
npm run release:export
```

The archive script rejects localhost, runs every verification gate, embeds `https://app.lofiever.dev`, synchronizes the layered app icon, and creates a timestamped archive under `build/`.

If automatic distribution signing is available, `release:export` creates the App Store package under `build/app-store-export/`. Otherwise open the archive in Xcode Organizer, select Distribute App, choose App Store Connect, and allow Xcode to manage signing.

## Upload and review

Upload with Xcode Organizer or Transporter. Then add the 1920×1080 screenshots from `store/screenshots`, paste the localized metadata, add the Apple TV privacy policy text, select the build, complete export compliance and content-rights declarations, and submit for review.

Increment `expo.ios.buildNumber` and `CURRENT_PROJECT_VERSION` before every replacement upload. Increment `expo.version`, `MARKETING_VERSION`, and `CFBundleShortVersionString` for a new public version.
