type FixturePropInit<
  Base extends Fixtures,
  Prop,
  > = Prop | ((context: Base) => Promise<Prop> | Prop);

type Fixtures = Record<string, unknown>;

type FixtureInit<
  Base extends Fixtures,
  Extend extends Fixtures = Record<string, never>,
> = Partial<Base> & {
  [name in keyof Extend]: FixturePropInit<Base, Extend[name]>;
};

type Test<BaseTest extends CallableFunction, T extends Fixtures> = {
  [key in keyof BaseTest]: BaseTest[key];
} & {
  (name: string, testFunc: (fixtures: T) => unknown): void;
  extend<U extends Fixtures>(
    fixtureInit: FixtureInit<T, U>
  ): Test<BaseTest, T & U>;
  extend<U extends Fixtures>(
    title: string,
    fixtureInit: FixtureInit<T, U>
  ): Test<BaseTest, T & U>;
};

const initFixture = async <T extends Fixtures, U extends Fixtures>(
  base: T,
  init: FixtureInit<U>,
): Promise<T & U> => {
  const extend = {} as Partial<U>;
  const propInitJobs = Object.entries(init)
    .map(async <K extends keyof U>([key, propInit]: [K, FixturePropInit<T, U[K]>]) => {
      extend[key] = (typeof propInit === 'function' ? await (propInit as CallableFunction)(base) : propInit) as U[K];
    });
  await Promise.all(propInitJobs);
  return { ...base, ...extend as U };
};

const wrap = <BaseTest extends CallableFunction, T extends Fixtures>(
  baseTest: BaseTest,
  title: string,
  fixtureInitList: FixtureInit<Partial<T>>[],
): Test<BaseTest, T> => {
  const proxy = new Proxy(baseTest, {
    apply(
      target,
      thisArg: unknown,
      [name, testFunc]: [string, (fixtures: T) => unknown],
    ) {
      baseTest(title ? `${title} - ${name}` : name, async () => {
        const fixtures = await fixtureInitList.reduce(
          async (initializing: Promise<Partial<T>>, init): Promise<Partial<T>> => (
            initFixture(await initializing, init)
          ),
          Promise.resolve({}),
        ) as T;
        await testFunc(fixtures);
      });
    },
  }) as {
    [key in keyof BaseTest]: BaseTest[key];
  } & { (name: string, testFunc: (fixtures: T) => unknown): void };

  return Object.assign(proxy, {
    extend<U extends Fixtures>(
      extendTitle: string | FixtureInit<T, U>,
      fixtureInit?: FixtureInit<T, U>,
    ) {
      let parsedTitle = extendTitle;
      let parsedInit = fixtureInit;
      if (typeof parsedTitle !== 'string') {
        parsedInit = parsedTitle;
        parsedTitle = '';
      }
      return wrap<BaseTest, T & U>(
        proxy,
        parsedTitle,
        [...fixtureInitList, parsedInit] as FixtureInit<Partial<T & U>>[],
      );
    },
  });
};

export default wrap;
