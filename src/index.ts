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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaseTest = (name: string, testFunc: (...args: any) => any) => any;

type Test<Base extends BaseTest, T extends Fixtures> = {
  [key in keyof Base]: Base[key];
} & {
  (
    name: string,
    testFunc: (fixtures: T) => ReturnType<Parameters<Base>[1]>
  ): ReturnType<Base>;
  extend<U extends Fixtures>(
    fixtureInit: FixtureInit<T, U>
  ): Test<Base, T & U>;
  extend<U extends Fixtures>(
    title: string,
    fixtureInit: FixtureInit<T, U>
  ): Test<Base, T & U>;
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

const wrap = <Base extends BaseTest, T extends Fixtures>(
  baseTest: Base,
  title: string,
  fixtureInitList: FixtureInit<Partial<T>>[],
): Test<Base, T> => {
  const proxy = new Proxy(baseTest, {
    apply: (
      target,
      thisArg: ThisType<Parameters<Base>[1]>,
      [name, testFunc]: [string, (fixtures: T) => ReturnType<Parameters<Base>[1]>],
    ) => (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      target(title ? `${title} - ${name}` : name, async () => {
        const fixtures = await fixtureInitList.reduce(
          async (initializing: Promise<Partial<T>>, init): Promise<Partial<T>> => (
            initFixture(await initializing, init)
          ),
          Promise.resolve({}),
        ) as T;
        return testFunc.call(thisArg, fixtures);
      })
    ),
  }) as {
    [key in keyof Base]: Base[key];
  } & {
    (
      this: ThisType<Parameters<Base>[1]>,
      name: string,
      testFunc: (fixtures: T) => ReturnType<Parameters<Base>[1]>
    ): ReturnType<Base>;
  };

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
      return wrap<Base, T & U>(
        proxy,
        parsedTitle,
        [...fixtureInitList, parsedInit] as FixtureInit<Partial<T & U>>[],
      );
    },
  });
};

export default wrap;
