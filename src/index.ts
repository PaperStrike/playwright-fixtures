type KeyValue = { [key: string]: unknown };

type TestFixture<R, Args extends KeyValue> = (
  args: Args,
  use: (r: R) => Promise<void>
) => Promise<void> | void;

type TestFixtureValue<R, Args extends KeyValue> = R | TestFixture<R, Args>;

// eslint-disable-next-line @typescript-eslint/ban-types
type Fixtures<T extends KeyValue, PT extends KeyValue = {}> = {
  [K in keyof PT]?: TestFixtureValue<PT[K], PT & T>;
} & {
  [K in keyof T]: TestFixtureValue<T[K], PT & T>;
};

type BaseTest = (name: string, inner: (...args: unknown[]) => Promise<void> | void) => unknown;

type Test<Args extends KeyValue, B extends BaseTest> = {
  [key in keyof B]: B[key];
} & {
  (
    name: string,
    inner: (args: Args, ...baseArgs: Parameters<Parameters<B>[1]>) => Promise<void> | void,
  ): void;
  // eslint-disable-next-line @typescript-eslint/ban-types
  extend<T extends KeyValue = {}>(
    fixtures: Fixtures<T, Args>
  ): Test<Args & T, B>;
  // eslint-disable-next-line @typescript-eslint/ban-types
  extend<T extends KeyValue = {}>(
    title: string,
    fixtures: Fixtures<T, Args>
  ): Test<Args & T, B>;
};

const prepareFixtures = async <T extends KeyValue, Args extends KeyValue>(
  base: Args,
  init: Fixtures<T, Args>,
): Promise<[Args & T, Promise<void>[], () => void]> => {
  const extend = {} as Partial<T>;
  let useResolve: () => void;
  let usePromise: Promise<void>;
  await new Promise<void>((construct) => {
    usePromise = new Promise<void>((resolve) => { useResolve = resolve; construct(); });
  });
  const finishJobs: Promise<void>[] = [];
  const prepareJobs = Object.entries(init)
    .map(<K extends keyof T>([key, fixtureValue]: [K, Fixtures<T, Args>[K]]) => (
      new Promise<void>((prepareValueResolve) => {
        /**
         * Check if it is callable.
         * Hard to be reliable and fast at the same time.
         */
        if (typeof fixtureValue === 'function') {
          const useValue = async (value: T[K]) => {
            extend[key] = value;
            prepareValueResolve();
            await usePromise;
          };
          finishJobs.push(
            // Package to promise, another resolve in case of it dont use `useValue`.
            Promise.resolve((fixtureValue as TestFixture<T[K], Args>)(base, useValue))
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
  return [{ ...base, ...extend as T }, finishJobs, useResolve!];
};

const wrapTest = <Args extends KeyValue, B extends BaseTest>(
  baseTest: B,
  title: string,
  fixturesList: Fixtures<Partial<Args>>[],
): Test<Args, B> => {
  const proxy = new Proxy(baseTest, {
    apply: (
      target,
      thisArg,
      [name, inner]: [string, (fixtures: Args, ...baseTestArgs: unknown[]) => Promise<void> | void],
    ) => (
      target.call(thisArg, title ? `${title} - ${name}` : name, async (...baseTestArgs) => {
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
  }) as {
    [key in keyof B]: B[key];
  } & {
    (
      this: ThisParameterType<Parameters<B>[1]>,
      name: string,
      inner: (fixtures: Args, ...baseArgs: Parameters<Parameters<B>[1]>) => Promise<void> | void
    ): ReturnType<B>;
  };

  return Object.assign(proxy, {
    extend<U extends KeyValue>(
      extendTitle: string | Fixtures<U, Args>,
      extendFixtures?: Fixtures<U, Args>,
    ): Test<Args & U, B> {
      let parsedTitle = extendTitle;
      let parsedFixtures = extendFixtures;
      if (typeof parsedTitle !== 'string') {
        parsedFixtures = parsedTitle;
        parsedTitle = '';
      }
      if (!parsedFixtures) throw new TypeError('No fixtures provided');
      return wrapTest<Args & U, B>(
        baseTest,
        parsedTitle,
        [...fixturesList, parsedFixtures] as Fixtures<Partial<Args & U>>[],
      );
    },
  });
};

const wrap = <B extends BaseTest = BaseTest>(
  baseTest: B,
  // eslint-disable-next-line @typescript-eslint/ban-types
): Test<{}, B> => wrapTest(baseTest, '', []);

export default wrap;
