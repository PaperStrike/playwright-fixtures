# playwright-fixtures

[![npm Package](https://img.shields.io/npm/v/playwright-fixtures?logo=npm "playwright-fixtures")](https://www.npmjs.com/package/playwright-fixtures)

Wrap your tests with Playwright-like test fixtures in node & browsers.

```shell
npm install playwright-fixtures --save-dev
```

> Playwright Test is based on the concept of the test fixtures. Test fixtures are used to establish environment for each test, giving the test everything it needs and nothing else.
>
> For more information, check [Advanced: fixtures | Playwright][playwright-docs-test-fixtures].

🐿️ Jump to [Entry](#entry).

[playwright-docs-test-fixtures]: https://playwright.dev/docs/test-fixtures/

## API

### Type BaseTest

Supported base tests. Generally, tests that accepts a string (as its name) and a function that can return a promise.

```ts
export type BaseTest =
  (name: string, inner: (...args: unknown[]) => Promise<void> | void) => unknown;
```

### Type Test

The test you get from this wrapper. All properties in the base test are retained, and the call signature is replaced.

```ts
type KeyValue = Record<string, unknown>;

type TestCall<Args extends KeyValue, B extends BaseTest> =
  B extends (name: string, inner: (...args: infer BaseArgs) => infer InnerReturn) => infer Return
    ? (name: string, inner: (args: Args, ...baseArgs: BaseArgs) => InnerReturn) => Return
    : never;

type Test<Args extends KeyValue, B extends BaseTest> = Pick<B, keyof B> & TestCall<Args, B> & {
  extend<T extends KeyValue = {}>(
    fixtures: Fixtures<T, Args>,
  ): Test<Args & T, B>;
};
```

#### Method extend

Extend fixtures like you do in Playwright. Parameters given by the base test will move right one position for it.

Example on [tape](https://github.com/substack/tape):

```ts
type TestFixtures = {
  input: HTMLInputElement;
};
const inputTest = test.extend<TestFixtures>({
  input: async (baseFixtures, use) => {
    const input = document.createElement('input');
    document.body.append(input);
    await use(input);
    input.remove();
  },
});
inputTest('focusable', ({ input }, t) => {
  input.focus();
  t.equal(document.activeElement, input);
  t.end();
});
```

```tap
TAP version 13
# focusable
ok 1 should be strictly equal
# ...
```

The report format depends entirely on your base test.

### Entry

The wrap function. Accepts one single argument, the base test. Returns the wrapped test.

```ts
declare const wrap: <B extends BaseTest = BaseTest>(baseTest: B) => Test<{}, B>;
export default wrap;
```

Use it like:

```ts
import { test as base } from 'uvu'; // mocha, tape, zora, etc.
import fixtureWrap from 'playwright-fixtures';
const test = fixtureWrap(base);

test('your tests', () => {
  // ...
});
```

## [LICENSE](LICENSE)
