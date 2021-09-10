type KeyValue = Record<string, unknown>;

type FixtureFunction<R, Args extends KeyValue> = (
  args: Args,
  use: (r: R) => Promise<void>,
) => Promise<void> | void;

// eslint-disable-next-line @typescript-eslint/ban-types
type FixtureValue<R, Args extends KeyValue> = R extends Function
  ? FixtureFunction<R, Args>
  : (FixtureFunction<R, Args> | R);

// eslint-disable-next-line @typescript-eslint/ban-types
type Fixtures<T extends KeyValue, PT extends KeyValue = {}> = {
  [K in keyof PT]?: FixtureValue<PT[K], PT & T>;
} & {
  [K in keyof T]: FixtureValue<T[K], PT & T>;
};

export type BaseTest =
  (name: string, inner: (...args: unknown[]) => Promise<void> | void) => unknown;

type TestCall<Args extends KeyValue, B extends BaseTest> =
  B extends (name: string, inner: (...args: infer BaseArgs) => infer InnerReturn) => infer Return
    ? (name: string, inner: (args: Args, ...baseArgs: BaseArgs) => InnerReturn) => Return
    : never;

type Test<Args extends KeyValue, B extends BaseTest> = Pick<B, keyof B> & TestCall<Args, B> & {
  // eslint-disable-next-line @typescript-eslint/ban-types
  extend<T extends KeyValue = {}>(
    fixtures: Fixtures<T, Args>,
  ): Test<Args & T, B>;
};

/**
 * Resolve fixture values, and returns the resolved values,
 * a callback to start cleaning jobs, and the promises of the cleaning jobs.
 */
const prepareFixtures = async <T extends KeyValue, PT extends KeyValue>(
  base: PT,
  init: Fixtures<T, PT>,
): Promise<[PT & T, () => void, Promise<void>[]]> => {
  const extend: Partial<T> = {};

  // The cleaning starter, called after the inner test and all sub-level fixtures are finished.
  let useResolve: () => void;
  let usePromise: Promise<void>;
  await new Promise<void>((construct) => {
    usePromise = new Promise<void>((resolve) => { useResolve = resolve; construct(); });
  });

  // The promises of the cleaning jobs.
  const finishJobs: Promise<void>[] = [];

  // Resolve fixture values.
  const prepareJobs = Object.entries(init)
    .map(<K extends keyof T>([key, fixtureValue]: [K, FixtureValue<T[K], PT & T>]) => (
      new Promise<void>((prepareValueResolve) => {
        /**
         * Check if it is callable.
         * Hard to be reliable and fast at the same time.
         * E.g., classes are functions, too.
         */
        if (typeof fixtureValue === 'function') {
          const useValue = async (value: T[K]) => {
            extend[key] = value;
            prepareValueResolve();
            await usePromise;
          };
          finishJobs.push(
            /**
             * Package to promise, chain with another resolve in case of
             * the fixture function finishes without using `useValue`.
             *
             * Specify the type of `extend` as `T` to allow users to use sibling fixtures
             * as in Playwright's official docs.
             * @TODO filter out constants before handling these fixture functions.
             * @see [Test fixtures - Advanced: fixtures | Playwright]{@link https://playwright.dev/docs/test-fixtures/#overriding-fixtures}
             */
            Promise
              .resolve((fixtureValue as FixtureFunction<T[K], PT & T>)(
                { ...base, ...extend as T },
                useValue,
              ))
              .then(prepareValueResolve),
          );
        } else {
          extend[key] = fixtureValue as T[K];
          prepareValueResolve();
        }
      })
    ));
  await Promise.all(prepareJobs);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return [{ ...base, ...extend as T }, useResolve!, finishJobs];
};

const wrapTest = <Args extends KeyValue, B extends BaseTest>(
  baseTest: B,
  fixturesList: Fixtures<Partial<Args>>[],
): Test<Args, B> => {
  // Proxy the call signature.
  const proxy = new Proxy(baseTest, {
    apply: (
      target,
      thisArg,
      [name, inner]: [string, (fixtures: Args, ...baseTestArgs: unknown[]) => Promise<void> | void],
    ) => (
      target.call(thisArg, name, async (...baseTestArgs) => {
        const finishList: [() => void, Promise<void>[]][] = [];
        const fixtures = await fixturesList.reduce(
          async (initializing, init) => {
            const [
              initialized,
              finishFunc,
              finishJobs,
            ] = await prepareFixtures(await initializing, init);
            finishList.push([finishFunc, finishJobs]);
            return initialized;
          },
          Promise.resolve({}),
        ) as Args;

        // A try block to avoid inner errors blocking the cleaning jobs.
        try {
          await inner.call(thisArg, fixtures, ...baseTestArgs);
        } finally {
          // Start the cleaning jobs, from sub-level fixtures to parent fixtures.
          await finishList.reduceRight(
            async (finishing: Promise<void>, [finishFunc, finishJobs]) => {
              await finishing;
              finishFunc();
              await Promise.all(finishJobs);
            },
            Promise.resolve(),
          );
        }
      })
    ),
  }) as Pick<B, keyof B> & TestCall<Args, B>;

  // Assign the `extend` method.
  return Object.assign(proxy, {
    extend<U extends KeyValue>(
      fixtures: Fixtures<U, Args>,
    ): Test<Args & U, B> {
      return wrapTest<Args & U, B>(
        baseTest,
        [...fixturesList, fixtures] as Fixtures<Partial<Args & U>>[],
      );
    },
  });
};

const wrap = <B extends BaseTest = BaseTest>(
  baseTest: B,
  // eslint-disable-next-line @typescript-eslint/ban-types
): Test<{}, B> => wrapTest(baseTest, []);

export default wrap;
