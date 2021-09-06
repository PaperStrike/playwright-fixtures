type KeyValue = {
  // Everything other than functions.
  // eslint-disable-next-line @typescript-eslint/ban-types, @typescript-eslint/no-explicit-any
  [K: string]: string | number | boolean | any[] | null | undefined | bigint | symbol | void | {};
};

type FixtureFunction<R, Args extends KeyValue> = (
  args: Args,
  use: (r: R) => Promise<void>,
) => Promise<void> | void;

type FixtureValue<R, Args extends KeyValue> = R | FixtureFunction<R, Args>;

// eslint-disable-next-line @typescript-eslint/ban-types
type Fixtures<T extends KeyValue, PT extends KeyValue = {}> = {
  [K in keyof PT]?: FixtureValue<PT[K], PT & T>;
} & {
  [K in keyof T]: FixtureValue<T[K], PT & T>;
};

type BaseTest = (name: string, inner: (...args: unknown[]) => Promise<void> | void) => unknown;

type Test<Args extends KeyValue, B extends BaseTest> = Pick<B, keyof B> & {
  (
    name: string,
    inner: (args: Args, ...baseArgs: Parameters<Parameters<B>[1]>) => Promise<void> | void,
  ): ReturnType<B>;
  // eslint-disable-next-line @typescript-eslint/ban-types
  extend<T extends KeyValue = {}>(
    fixtures: Fixtures<T, Args>,
  ): Test<Args & T, B>;
};

const prepareFixtures = async <T extends KeyValue, PT extends KeyValue>(
  base: PT,
  init: Fixtures<T, PT>,
): Promise<[PT & T, Promise<void>[], () => void]> => {
  const extend: Partial<T> = {};
  let useResolve: () => void;
  let usePromise: Promise<void>;
  await new Promise<void>((construct) => {
    usePromise = new Promise<void>((resolve) => { useResolve = resolve; construct(); });
  });
  const finishJobs: Promise<void>[] = [];
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
             * Assert `extend` type `T` to make it possible for users to use peer fixtures
             * as in Playwright's official docs.
             * @TODO filter out constants before handling these fixture functions.
             * @see [Test fixtures - Advanced: fixtures | Playwright]{@link https://playwright.dev/docs/test-fixtures/#overriding-fixtures}
             */
            Promise.resolve(fixtureValue({ ...base, ...extend as T }, useValue))
              .then(prepareValueResolve),
          );
        } else {
          extend[key] = fixtureValue;
          prepareValueResolve();
        }
      })
    ));
  await Promise.all(prepareJobs);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return [{ ...base, ...extend as T }, finishJobs, useResolve!];
};

const wrapTest = <Args extends KeyValue, B extends BaseTest>(
  baseTest: B,
  fixturesList: Fixtures<Partial<Args>>[],
): Test<Args, B> => {
  const proxy = new Proxy(baseTest, {
    apply: (
      target,
      thisArg,
      [name, inner]: [string, (fixtures: Args, ...baseTestArgs: unknown[]) => Promise<void> | void],
    ) => (
      target.call(thisArg, name, async (...baseTestArgs) => {
        const finishList: [Promise<void>[], () => void][] = [];
        const fixtures = await fixturesList.reduce(
          async (initializing, init) => {
            const [
              initialized,
              finishJobs,
              finishFunc,
            ] = await prepareFixtures(await initializing, init);
            finishList.push([finishJobs, finishFunc]);
            return initialized;
          },
          Promise.resolve({}),
        ) as Args;
        try {
          await inner.call(thisArg, fixtures, ...baseTestArgs);
        } finally {
          await finishList.reduceRight(
            async (finishing: Promise<void>, [finishJobs, finishFunc]) => {
              await finishing;
              finishFunc();
              await Promise.all(finishJobs);
            },
            Promise.resolve(),
          );
        }
      })
    ),
  }) as Pick<B, keyof B> & {
    (
      this: ThisParameterType<Parameters<B>[1]>,
      name: string,
      inner: (fixtures: Args, ...baseArgs: Parameters<Parameters<B>[1]>) => Promise<void> | void,
    ): ReturnType<B>;
  };

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
