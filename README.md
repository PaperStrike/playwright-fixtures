# test-fixtures-wrap

[![npm Package](https://img.shields.io/npm/v/test-fixtures-wrap?logo=npm "test-fixtures-wrap")](https://www.npmjs.com/package/test-fixtures-wrap)

Wrap your tests with playwright-like test fixtures in node or browsers.

```shell
npm install test-fixtures-wrap --save-dev
```

---

Playwright Test is based on the concept of the _test fixtures_. Test fixtures are used to establish environment for each test, giving the test everything it needs and nothing else.

For more information, check [Advanced: fixtures | Playwright][playwright-docs-test-fixtures].

[playwright-docs-test-fixtures]: https://playwright.dev/docs/test-fixtures/

## API

### Type BaseTest

Supported base tests. Basically, tests that accepts a string as its name and a test function that could return a promise.

```ts
type BaseTest = (name: string, inner: (...args: unknown[]) => Promise<void> | void) => unknown;
```

### Type Test

The test you get from this wrapper. All properties in the base test will be preserved, while the call signatures will be replaced.

```ts
type KeyValue = Record<string, unknown>;
type Test<TestArgs extends KeyValue, B extends BaseTest> = {
  [key in keyof B]: B[key];
} & {
  (
    name: string,
    inner: (args: TestArgs, ...baseArgs: Parameters<Parameters<B>[1]>) => Promise<void> | void,
  ): void;
  extend<T extends KeyValue = {}>(
    fixtures: Fixtures<T, TestArgs>
  ): Test<TestArgs & T, B>;
  extend<T extends KeyValue = {}>(
    title: string,
    fixtures: Fixtures<T, TestArgs>
  ): Test<TestArgs & T, B>;
};
```

#### Method extend

Extend fixtures like you do in playwright. Parameters given by the base test will move right one position for it.

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

Optionally, pass a string to prepend a title for the extended tests.

```ts
type TestFixtures = {
  button: HTMLButtonElement;
};
const buttonTest = test.extend<TestFixtures>('button', {
  button: async (baseFixtures, use) => {
    const button = document.createElement('button');
    document.body.append(button);
    await use(button);
    button.remove();
  },
});
buttonTest('inline-block', ({ button }, t) => {
  const { display } = window.getComputedStyle(button);
  t.equal(display, 'inline-block');
  t.end();
});
buttonTest('focusable', ({ button }, t) => {
  button.focus();
  t.equal(document.activeElement, button);
  t.end();
});
```

```tap
TAP version 13
# button - inline-block
ok 1 should be strictly equal
# button - focusable
ok 2 should be strictly equal
# ...
```

The report format totally depends on your base test. This wrapper only change the test names to `${title} - ${name}`.

### Entry

The wrap function. Accepts one single argument, the base test. Returns the wrapped test.

```ts
export default function wrap<Base extends BaseTest>(baseTest: Base): Test<Record<string, unknown>, Base>
```

Use it like:

```ts
import { test as base } from 'uvu'; // mocha, tape, zora, etc.
import fixtureWrap from 'test-fixtures-wrap';
const test = fixtureWrap(base);

test('your tests', () => {
  // ...
});
```

## [LICENSE](LICENSE)
