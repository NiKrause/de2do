# BrowserStack Cross-Browser Testing Setup

This document provides a complete setup for running Playwright tests on BrowserStack across multiple browsers and platforms for the Simple Todo consent screen functionality.

## 🎯 What's Been Set Up

### 1. Test Suite

- **Comprehensive consent screen testing** covering modal display, checkbox validation, consent persistence, and feature information display
- **Cross-browser compatibility** tests for Chrome, Firefox, Safari, Edge, and Opera
- **Mobile testing** on iOS Safari and Android Chrome
- **Local fallback testing** for development and validation

### 2. BrowserStack Integration

- **Playwright configuration** with conditional BrowserStack vs local testing
- **Browser matrix** covering Windows 11, macOS Monterey, Linux Ubuntu, iOS 16, and Android 12
- **Local tunnel management** for testing localhost applications on BrowserStack
- **Environment-based configuration** using environment variables

### 3. CI/CD Pipeline

> **Note:** This repository does **not** currently ship a `browserstack-tests.yml` workflow. Core E2E is in **`e2e-tests.yml`**. Add your own BrowserStack workflow if you need cloud browsers in CI.

- Optional: **GitHub Actions** + BrowserStack secrets
- **Artifact collection** for test results, reports, and screenshots

## 📁 File Structure

```
simple-todo/
├── e2e/
│   └── consent-screen.spec.js              # Main test suite
├── scripts/
│   └── browserstack-local.js               # BrowserStack Local tunnel management
├── docs/
│   ├── TESTING.md                          # Testing guide
│   └── BROWSERSTACK_TESTING_SETUP.md       # This file
├── .github/workflows/
│   └── e2e-tests.yml                       # Local Playwright CI (not BrowserStack)
├── .env.browserstack.example               # Environment template (if used)
├── playwright.config.js                   # Playwright configuration
└── package.json
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pnpm install
pnpm exec playwright install --with-deps
```

### 2. Run Local Tests

```bash
pnpm run test:consent
```

### 3. Set Up BrowserStack (Optional)

```bash
# Copy environment template
cp .env.browserstack.example .env.local

# Add your BrowserStack credentials to .env.local
# Then run BrowserStack tests
pnpm run test:consent:browserstack
```

### 4. Set Up GitHub Actions

Add these secrets to your GitHub repository:

- `BROWSERSTACK_USERNAME`
- `BROWSERSTACK_ACCESS_KEY`

## 🌐 Browser Coverage

| Browser | Windows 11 | macOS Monterey | Linux Ubuntu | iOS 16 | Android 12 |
| ------- | ---------- | -------------- | ------------ | ------ | ---------- |
| Chrome  | ✅         | ✅             | ✅           | ❌     | ✅         |
| Firefox | ✅         | ✅             | ❌           | ❌     | ❌         |
| Safari  | ❌         | ✅             | ❌           | ✅     | ❌         |
| Edge    | ✅         | ❌             | ❌           | ❌     | ❌         |
| Opera   | ✅         | ❌             | ❌           | ❌     | ❌         |
| Brave   | ⚠️ Local   | ⚠️ Local       | ⚠️ Local     | ❌     | ❌         |

**Note**: Brave browser requires local installation and is not available on standard BrowserStack plans.

## 📊 Test Cases

### 1. Consent Modal Display

- ✅ Modal appears on page load
- ✅ Contains correct title and version information
- ✅ Shows all required checkboxes
- ✅ Proceed button is initially disabled

### 2. Checkbox Validation

- ✅ All checkboxes start unchecked
- ✅ Individual checkbox state changes work
- ✅ Proceed button enables only when all boxes checked
- ✅ Button text changes appropriately

### 3. Consent Persistence

- ✅ "Don't show again" checkbox works
- ✅ Modal doesn't appear on page reload when remembered
- ✅ localStorage is properly managed

### 4. Feature Information Display

- ✅ All required privacy features are listed
- ✅ Information is accurate and complete
- ✅ Text matches application behavior

## 🛠 Available Scripts

```json
{
  \"test:e2e\": \"playwright test\",
  \"test:consent\": \"playwright test e2e/consent-screen.spec.js\",
  \"test:browserstack\": \"BROWSERSTACK_BUILD_NAME=local-test playwright test\",
  \"test:consent:browserstack\": \"BROWSERSTACK_BUILD_NAME=consent-test playwright test e2e/consent-screen.spec.js\",
  \"test:browserstack:local\": \"node scripts/browserstack-local.js start\"
}
```

## 🔧 Configuration Options

### Environment Variables

```bash
BROWSERSTACK_USERNAME=your_username
BROWSERSTACK_ACCESS_KEY=your_access_key
BROWSERSTACK_BUILD_NAME=optional_build_name
```

### Playwright Config Features

- **Conditional BrowserStack** vs local testing
- **Multiple browser projects** with specific capabilities
- **Timeout configuration** optimized for BrowserStack
- **Screenshot and video** capture on failures
- **Trace collection** for debugging

### BrowserStack Capabilities

```javascript
{
  'browserstack.local': 'true',          // Local tunnel support
  'browserstack.debug': 'true',          // Enhanced debugging
  'browserstack.console': 'verbose',     // Console logging
  'browserstack.networkLogs': 'true'     // Network monitoring
}
```

## 📈 CI/CD Pipeline

### Workflow Triggers

- Push to `main` or `develop` branches
- Pull requests to `main`
- Manual workflow dispatch

### Execution Strategy

- **3 parallel batches** to optimize BrowserStack usage
- **Batch 1**: Windows & Linux desktop browsers
- **Batch 2**: macOS desktop browsers & Opera
- **Batch 3**: Mobile browsers (iOS Safari, Android Chrome)

### Artifact Collection

- Test results and reports (30-day retention)
- Screenshots and videos on failure
- Comprehensive test summaries

## 🐛 Troubleshooting

### Common Issues

1. **BrowserStack tunnel connection failures**
   - Verify access key and firewall settings
   - Check BrowserStack account limits

2. **Mobile test timeouts**
   - Mobile devices may be slower
   - Consider increasing timeouts for mobile

3. **GitHub Actions failures**
   - Ensure secrets are properly configured
   - Check BrowserStack parallel session limits

### Debug Mode

```bash
DEBUG=playwright:* pnpm run test:consent
```

## 📝 Next Steps

1. **Expand Test Coverage**: Add more test scenarios as the application grows
2. **Performance Testing**: Consider adding performance benchmarks
3. **Accessibility Testing**: Integrate accessibility testing tools
4. **Visual Regression**: Add visual comparison testing
5. **API Testing**: Test backend endpoints if added

## 📚 Resources

- [Playwright Documentation](https://playwright.dev/)
- [BrowserStack Automate Docs](https://www.browserstack.com/docs/automate)
- [Testing Guide](./docs/TESTING.md)
- [GitHub Actions Docs](https://docs.github.com/en/actions)

## ✅ Verification Checklist

- [x] Local Playwright tests pass
- [x] BrowserStack configuration is complete
- [x] GitHub workflow is set up
- [x] Multiple browser/platform matrix configured
- [x] Consent screen functionality fully tested
- [x] Documentation is comprehensive
- [x] Environment setup is documented

This setup provides a robust, scalable testing infrastructure that can grow with your project while ensuring consistent cross-browser functionality for the consent screen and future features.
