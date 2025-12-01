# Refactoring Test Plan

## What Was Refactored

The `src/routes/+page.svelte` file (1425 lines) has been partially refactored by extracting key utilities:

### Extracted Utilities

1. **`src/lib/database/database-opener.js`**
   - `openDatabaseWithEncryptionDetection()` - Automatically detects if DB is encrypted
   - `openDatabaseWithPassword()` - Opens DB with password
   - `validateDatabaseEntry()` - Checks if entry looks encrypted
   - `detectEncryption()` - Determines if database has encrypted data

2. **`src/lib/database/database-manager.js`**
   - `openDatabaseWithPasswordPrompt()` - High-level opener with automatic password prompting
   - `updateStoresAfterDatabaseOpen()` - Updates all stores and registry after DB opens

3. **`src/lib/password/password-manager.js`**
   - `passwordManager` store - Promise-based password request system
   - `requestPasswordWithRetry()` - Password request with retry logic

4. **`src/lib/embed/embed-handler.js`**
   - `detectEmbedMode()` - Check if URL is embed route
   - `parseEmbedParams()` - Parse embed query parameters
   - `buildEmbedUrl()` - Build embed URLs

5. **`src/lib/handlers/todo-handlers.js`**
   - `createTodoHandlers()` - Factory for todo event handlers

6. **`src/lib/debug/database-debug.js`**
   - `setupDatabaseDebug()` - Debugging utilities
   - `exposeDatabaseToWindow()` - E2E testing helpers

7. **`src/lib/components/layout/AppHeader.svelte`**
   - Extracted header component

8. **`src/lib/components/ui/ManagedPasswordModal.svelte`**
   - Password modal wrapper using passwordManager

## Testing Plan

### 1. Test Database Opening via Browser URL

#### Test 1.1: Open Unencrypted Database via URL

1. Start dev server: `npm run dev`
2. Create a test database (e.g., "test-db")
3. Copy the database address from the UI
4. Open a new tab with URL: `http://localhost:5173/#/orbitdb/[address]`
5. **Expected**: Database opens automatically without password prompt
6. **Expected**: Todos load correctly

#### Test 1.2: Open Encrypted Database via URL

1. Create an encrypted database with password "test123"
2. Copy the database address
3. Open new tab with URL: `http://localhost:5173/#/orbitdb/[address]`
4. **Expected**: Password modal appears automatically
5. **Expected**: Database opens after correct password entry
6. **Expected**: Todos decrypt and display correctly

#### Test 1.3: Wrong Password Handling

1. Use encrypted database URL from Test 1.2
2. Enter wrong password
3. **Expected**: Error message "Incorrect password. Attempt 1/3"
4. **Expected**: Modal stays open for retry
5. Enter wrong password 2 more times
6. **Expected**: "Too many failed attempts" message
7. **Expected**: Modal closes

### 2. Test Database Opening via UserList → TodoList Selector

#### Test 2.1: Switch to Unencrypted List

1. Open application normally
2. Use TodoList Selector dropdown
3. Select an unencrypted list
4. **Expected**: Switches immediately without password
5. **Expected**: Correct todos display

#### Test 2.2: Switch to Encrypted List

1. Create encrypted list with password
2. Switch to another list
3. Switch back to encrypted list using selector
4. **Expected**: Password modal appears
5. **Expected**: Correct password unlocks the list
6. **Expected**: Encrypted todos decrypt properly

### 3. Test Sub-List Creation

#### Test 3.1: Create Unencrypted Sub-List

1. Select a todo item
2. Click "Create Sub-List"
3. Enter sub-list name
4. **Expected**: Sub-list created
5. **Expected**: Navigation to new sub-list
6. **Expected**: Breadcrumb shows hierarchy

#### Test 3.2: Create Encrypted Sub-List

1. Enable encryption checkbox
2. Enter encryption password
3. Create sub-list from a todo
4. **Expected**: Encrypted sub-list created
5. Navigate away and back to sub-list
6. **Expected**: Password prompt appears
7. **Expected**: Correct password allows access

### 4. Test Embed Mode

#### Test 4.1: Embed Unencrypted Database (Read-Only)

1. Get database address
2. Open URL: `http://localhost:5173/#/embed/orbitdb/[address]`
3. **Expected**: Shows todos in embed mode
4. **Expected**: No "Add Todo" form visible
5. **Expected**: Cannot edit or delete

#### Test 4.2: Embed with allowAdd

1. Open URL: `http://localhost:5173/#/embed/orbitdb/[address]?allowAdd=true`
2. **Expected**: "Add Todo" form visible
3. **Expected**: Can add new todos
4. **Expected**: Header is hidden (embed mode)

#### Test 4.3: Embed Encrypted Database

1. Get encrypted database address
2. Open embed URL
3. **Expected**: Password modal appears
4. Enter correct password
5. **Expected**: Encrypted todos decrypt and display

## Encryption Detection Test

The key improvement is **automatic encryption detection**. Test this by:

1. Create database with encryption enabled
2. Add some todos
3. Close browser/clear session
4. Open database by address in new session
5. **Expected**: System detects encrypted data automatically
6. **Expected**: Password prompt appears without manual intervention

## Integration Points to Verify

- [ ] Password manager state properly resets between attempts
- [ ] Store updates happen correctly after DB opens
- [ ] Registry persistence works for new databases
- [ ] Hierarchy/breadcrumb updates when switching DBs
- [ ] User list updates when opening foreign databases
- [ ] Todos reload correctly after DB switch
- [ ] Debug utilities (`window.debugDatabase()`) still work
- [ ] E2E test helpers (`window.__currentDbAddress__`) still exposed

## Known Limitations

Current integration is partial. The main `+page.svelte` still contains:

- Full hash routing logic (lines 175-621)
- Original database opening code
- Inline event handlers

**Next Steps for Complete Integration**:

1. Replace hash routing with extracted utilities
2. Use `openDatabaseWithPasswordPrompt()` instead of inline logic
3. Use `createTodoHandlers()` for event handling
4. Further componentize the large template sections

## Build Status

✅ **Build Successful** - All extracted utilities compile without errors
✅ **No Breaking Changes** - Existing functionality preserved
✅ **Type Safety** - JSDoc comments for IDE support
