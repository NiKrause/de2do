# Testing Guide

> **CI:** Core E2E runs in **`.github/workflows/e2e-tests.yml`**. Passkey + escrow (Anvil, Docker Alto) runs in **`.github/workflows/e2e-passkey-escrow.yml`**. There is **no** `browserstack-tests.yml` in this repo anymore; BrowserStack below is **optional / manual** unless you add a workflow.

This document covers **Playwright** (including consent screen tests) **locally** and optional **BrowserStack** setup.

## Overview

The test suite includes comprehensive cross-browser testing for the consent screen modal functionality, including:

- Modal display and visibility
- Checkbox interactions and validation
- Proceed button state management
- Consent persistence functionality
- Feature information display

## Test Structure

### Files

- `e2e/consent-screen.spec.js` - Main consent screen test suite
- `playwright.config.js` - Local Playwright config
- `scripts/browserstack-local.js` - BrowserStack Local tunnel helper (if you use BrowserStack)

### Test Cases

1. **Consent Modal Display** - Verifies the modal appears and contains required elements
2. **Checkbox Validation** - Tests that all checkboxes must be checked to proceed
3. **Consent Persistence** - Validates the "Don't show again" functionality
4. **Feature Information** - Ensures all required consent information is displayed

## Local Testing

### Prerequisites

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Install Playwright browsers:
   ```bash
   pnpm exec playwright install --with-deps
   ```

### Running Tests

Run all tests locally:

```bash
pnpm run test:e2e
```

Run only consent screen tests:

```bash
pnpm exec playwright test e2e/consent-screen.spec.js
# or: npm run test:e2e -- e2e/consent-screen.spec.js
```

Run with UI mode for debugging:

```bash
pnpm exec playwright test --ui
```

## BrowserStack Testing

### Setup

1. Sign up for a [BrowserStack](https://www.browserstack.com/) account
2. Get your username and access key from Account Settings
3. Copy the environment template:
   ```bash
   cp .env.browserstack.example .env.local
   ```
4. Fill in your credentials in `.env.local`

### Local BrowserStack Testing

Test on BrowserStack while running the app locally:

```bash
pnpm run test:consent:browserstack
```

### GitHub Actions (BrowserStack)

There is **no** checked-in BrowserStack workflow in this repository. To run BrowserStack in CI, add your own workflow and secrets (`BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`), or run tests locally with the tunnel (above).

## Supported Browsers & Platforms

### Desktop Browsers

| Browser | Windows 11 | macOS Monterey | Linux Ubuntu 20.04 |
| ------- | ---------- | -------------- | ------------------ |
| Chrome  | ✅         | ✅             | ✅                 |
| Firefox | ✅         | ✅             | ❌                 |
| Edge    | ✅         | ❌             | ❌                 |
| Safari  | ❌         | ✅             | ❌                 |
| Opera   | ✅         | ❌             | ❌                 |

### Mobile Browsers

| Browser | iOS 16 | Android 12 |
| ------- | ------ | ---------- |
| Safari  | ✅     | ❌         |
| Chrome  | ❌     | ✅         |

### Browser Notes

- **Brave**: Not available on standard BrowserStack plans. For Brave testing, install locally and use `channel: 'brave'` in local configuration
- **Opera**: Available on Windows only through BrowserStack
- **Mobile Safari**: Tested on iPhone 14
- **Mobile Chrome**: Tested on Samsung Galaxy S22

## Test Configuration

### BrowserStack Capabilities

The tests use these BrowserStack-specific configurations:

```javascript
{
  'browserstack.local': 'true',        // Enable local testing
  'browserstack.debug': 'true',        // Enable debugging
  'browserstack.console': 'verbose',   // Verbose console logs
  'browserstack.networkLogs': 'true'   // Network logging
}
```

### Timeouts

- Test timeout: 60 seconds
- Expect timeout: 30 seconds
- Server startup timeout: 60 seconds

## Troubleshooting

### Common Issues

1. **BrowserStack tunnel fails to connect**
   - Check your access key is correct
   - Ensure firewall allows BrowserStack Local connections
   - Try restarting the tunnel: `pnpm run test:browserstack:local`

2. **Tests timeout on mobile devices**
   - Mobile devices may be slower to load
   - Consider increasing timeouts for mobile-specific tests

3. **Consent modal not found**
   - Ensure localStorage is cleared between tests
   - Check that the app is properly built and served

4. **GitHub Actions failing**
   - Verify BrowserStack secrets are properly set
   - Check if BrowserStack account has sufficient parallel testing slots

### Debug Mode

Enable debug mode for detailed logs:

```bash
DEBUG=playwright:* pnpm exec playwright test e2e/consent-screen.spec.js
```

### Local Development

For faster iteration during development:

1. Start the dev server:

   ```bash
   pnpm run dev
   ```

2. Update `playwright.config.js` to use `http://localhost:5173`

3. Run tests against the dev server

## Reporting

### Local Reports

Playwright generates HTML reports after test runs:

```bash
pnpm exec playwright show-report
```

### CI Reports

GitHub Actions uploads:

- Test results as artifacts
- Playwright HTML reports
- Screenshots and videos on failure

Reports are available in the Actions tab and retained for 30 days.

## Best Practices

1. **Test Isolation**: Each test starts with a clean browser context
2. **Explicit Waits**: Use Playwright's built-in waiting mechanisms
3. **Stable Selectors**: Use data-testid attributes when possible
4. **Error Handling**: Tests handle both success and failure scenarios
5. **Resource Cleanup**: Tests clean up localStorage and other state

## Contributing

When adding new tests:

1. Follow the existing test structure
2. Add appropriate browser coverage
3. Update this documentation
4. Ensure tests work both locally and on BrowserStack

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [BrowserStack Automate Documentation](https://www.browserstack.com/docs/automate)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
