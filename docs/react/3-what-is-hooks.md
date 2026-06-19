# Hooks: React 如何在函数组件中保存状态和副作用

在上一篇的结尾我们提到了，FiberNode 的 `memoizedState` 会保存函数组件的 Hooks 链表。

这就引出了一个很反直觉的问题：函数组件本质上只是一个函数。函数每次执行都会重新创建局部变量，执行结束后局部变量也会消失。那为什么我们在函数组件里调用 `useState`，下一次 render 时还能拿到上一次的 state？

这一篇就沿着这个问题往下看：Hooks 的状态放在哪里？多个 Hook 如何按顺序对应？一次 `setState` 又是如何进入更新队列，并在下一次 render 中得到新的 state？

---

## class 组件为什么天然有地方存状态

在讨论函数组件之前，先看看古早的 class 组件。对它来说，我们要探讨的状态挂载问题是不存在的：因为每个 class 组件在 React 内部都会被实例化，状态就挂在这个实例的 `this.state` 上。

```jsx
class Counter extends React.Component {
  constructor(props) {
    super(props)
    // 状态直接挂在实例上
    this.state = { count: 0 }
  }

  handleClick = () => {
    // setState 也是实例方法，它知道要更新“哪个实例”
    this.setState({ count: this.state.count + 1 })
  }

  render() {
    return <button onClick={this.handleClick}>{this.state.count}</button>
  }
}
```

回忆一下上一篇的 FiberNode：对 class 组件来说，这个实例对象会被挂在对应 FiberNode 的 `stateNode` 上。也就是说：

- 实例本身由 FiberNode 持有（`fiber.stateNode`）
- 实例不会随着 render 消失，那 `this.state` 自然能跨越多次 render 存在
- `this.setState` 绑定在实例上，天然知晓“要更新哪个组件”

所以 class 组件根本不需要“按顺序”之类的约束——状态有明确的归属（实例），更新有明确的入口（实例方法）。

---

## 函数组件的问题：函数执行结束后，局部变量会消失

函数组件没有实例。它就是一个普普通通的函数，render 一次就是调用一次：

```jsx
function Counter() {
  // 每次 render，这个函数都会被重新调用
  // count 是一个局部变量，调用结束后就被回收了
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

如果按照普通函数的直觉，`count` 是一个每次调用都会被重新初始化的局部变量，函数返回后它就消失了。那 `useState(0)` 为什么在第二次、第三次 render 时不会一直返回初始值 `0`？

不难推断出一个结论：状态并不是存放在函数内部的局部变量里。而是被存放在了某个能够跨越多次调用而存活的地方。

这个地方，就是上一篇讲过的、React 的核心概念之一的 FiberNode。

一言以蔽之，函数组件丢掉了实例，所以 React 需要替它找一个新的“状态持有者”，并且还要解决两个实例本来天然就解决了的问题：

1. 归属问题：这次调用的 `useState` 对应的是哪个组件、哪一份状态？
2. 对应问题：一个组件里有好几个 `useState` / `useEffect`，React 怎么知道这次的第二个 `useState` 对应上一次的哪一个？

带着这两个问题，我们进入正题。

---

## Hooks 状态放在哪里：FiberNode.memoizedState

先解决归属问题。

答案上一篇其实已经提到了：函数组件的状态挂在它对应的 FiberNode 的 `memoizedState` 上。而且，`memoizedState` 存的不是“一份 state”，而是一条 Hooks 链表。

通常来说每调用一个`useState`、`useEffect`、`useRef` 这类需要保存运行时信息的 Hook，React 就会在这条链表上生成一个 Hook 节点，多个 Hook 按调用顺序串成单链表。下面的代码实例的类型是 `useState` 特化，实际上源代码中是 `any`。当然，类似于 context 这种 non-stateful 的 hook 属于例外，我们可以后面展开。

这里的 `S` 是个泛型，具体是什么取决于你给 `useState` 的初始值。比如 `const [count, setCount] = useState(0)`，`0` 是 `number`，那 `S` 就是 `number`，这个节点就被具体化成（`BasicStateAction<number> = ((prev: number) => number) | number`），所以 `queue` 就是 `UpdateQueue<number, BasicStateAction<number>>`，里面排队的每个 `Update` 的 `action` 要么是一个新的 `number`，要么是一个 `(prev: number) => number` 的更新函数。

当然，这里的字段展开比较彻底，可能会对其中的一些概念不太了解，没关系，我们稍后会一一讲透

```tsx
// BasicStateAction<S> = ((prev: S) => S) | S
type Hook<S> = {
  memoizedState: S,                                  // useState 存的当前 state，类型就是 S
  baseState: S,                                      // 计算新 state 的基础值，同样是 S
  baseQueue: Update<S, BasicStateAction<S>> | null,  // 之前被跳过的 update 组成的队列
  queue: UpdateQueue<S, BasicStateAction<S>> | null, // 本次的更新队列（setState 入队的地方）
  next: Hook | null,                                 // 指向下一个 Hook，串成链表
}

// 一次 setState 产生一个 Update（这里 A = BasicStateAction<S>）
type Update<S, A> = {
  lane: Lane,              // 这次更新的优先级（lanes，下一篇讲）
  action: A,               // 你传给 setState 的值或函数，比如 5 或 c => c + 1
  hasEagerState: boolean,  // 是否已经提前算出结果（eager state 优化）
  eagerState: S | null,    // 提前算好的新 state
  next: Update<S, A>,      // 指向下一个 update —— 多个 update 串成环状链表
}

// 每个 hook 挂一个 UpdateQueue，收集这个 hook 上所有待处理的 Update
type UpdateQueue<S, A> = {
  pending: Update<S, A> | null,               // 待处理 update 环的“尾”指针（见后文环状链表）
  lanes: Lanes,                               // 这些待处理更新的优先级集合
  dispatch: (A => mixed) | null,              // 就是 setState 本身
  lastRenderedReducer: ((S, A) => S) | null,  // useState 这里固定是 basicStateReducer
  lastRenderedState: S | null,                // 上一次渲染出的 state（eager 比较时用）
}
```

于是“函数组件的状态放在哪里”这个问题就有了完整答案：

- `fiber.memoizedState` → 第一个 Hook
- `firstHook.next` → 第二个 Hook
- ……依次类推

只要 React 在 render 时能拿到这个 FiberNode，就能顺着 `memoizedState` 得到整条 Hooks 链，从而恢复“上一次的状态”。

---

## Hooks 为什么必须按固定顺序调用：链表与 currentHook / workInProgressHook

接下来是更关键的对应问题，也就是那条著名规则的由来：Hooks 不能写在条件、循环或提前 return 之后（即 `if` / `for` / `return` 之后）。

要理解这条规则，得先了解 React 在执行函数组件时维护了两个全局指针：

```jsx
// react-reconciler/src/ReactFiberHooks.js
// 当前正在 render 的函数组件对应的 Fiber
let currentlyRenderingFiber: Fiber | null = null

// currentHook：指向“上一次 render”那条链表的当前节点（即 current 树上的 Hook）
let currentHook: Hook | null = null

// workInProgressHook：指向“这一次 render”正在构建的链表的当前节点
let workInProgressHook: Hook | null = null
```

注意这里又出现了上一篇讲过的双缓冲策略：`currentHook` 走的是 current 树（屏幕上的旧状态）的 Hook 链，`workInProgressHook` 走的是 workInProgress 树（正在构建的新状态）的 Hook 链。

### 组件 mount 阶段：边调用边把节点接到链表尾

首次渲染时，当前组件没有上一轮的 Hook 链，所以每调用一个 Hook 就 new 一个节点接到尾部：

```jsx
// react-reconciler/src/ReactFiberHooks.js
function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    memoizedState: null,
    baseState: null,
    baseQueue: null,
    queue: null,
    next: null,
  }

  if (workInProgressHook === null) {
    // 这是本次 render 的第一个 Hook：
    // 把它挂到 fiber.memoizedState，作为链表头
    currentlyRenderingFiber.memoizedState = workInProgressHook = hook
  } else {
    // 不是第一个：接到上一个 Hook 的 next 后面，并把游标前移
    workInProgressHook = workInProgressHook.next = hook
  }
  return workInProgressHook
}
```

所以 mount 阶段所谓的“顺序”其实就是一个朴素事实：你先写 `useState` 再写 `useEffect`，链表就长成这个顺序，没有任何名字、没有任何 key。

### 组件 update 阶段：靠 next 按位置取回旧节点

更新渲染时，React 并不知道你这个 `useState` 叫什么名字，它只知道“这是本次 render 的第 N 次 Hook 调用”。于是它做的事情是：从旧链表里取出第 N 个节点，克隆成新节点接到新链表上。

```jsx
// react-reconciler/src/ReactFiberHooks.js
function updateWorkInProgressHook(): Hook {
  // 1. 先确定要复用的“旧节点”——也就是 current 树上的第 N 个 Hook
  let nextCurrentHook: null | Hook
  if (currentHook === null) {
    const current = currentlyRenderingFiber.alternate
    nextCurrentHook = current !== null ? current.memoizedState : null
  } else {
    nextCurrentHook = currentHook.next
  }

  // 2. 再确定新链表的下一个位置
  let nextWorkInProgressHook: null | Hook
  if (workInProgressHook === null) {
    nextWorkInProgressHook = currentlyRenderingFiber.memoizedState
  } else {
    nextWorkInProgressHook = workInProgressHook.next
  }

  if (nextWorkInProgressHook !== null) {
    // 已经有现成的节点（比如组件本轮被重复 render），直接复用
    workInProgressHook = nextWorkInProgressHook
    currentHook = nextCurrentHook
  } else {
    // 正常情况：旧链表必须还有节点，否则说明“这次比上次多调用了一个 Hook”
    if (nextCurrentHook === null) {
      throw new Error('Rendered more hooks than during the previous render.')
    }
    currentHook = nextCurrentHook

    // 用旧节点的数据克隆出一个新节点
    const newHook: Hook = {
      memoizedState: currentHook.memoizedState,
      baseState: currentHook.baseState,
      baseQueue: currentHook.baseQueue,
      queue: currentHook.queue,
      next: null,
    }

    if (workInProgressHook === null) {
      currentlyRenderingFiber.memoizedState = workInProgressHook = newHook
    } else {
      workInProgressHook = workInProgressHook.next = newHook
    }
  }
  return workInProgressHook
}
```

所以这条规则就很好理解了：update 阶段是靠调用次序（第 N 次调用 ↔ 旧链表第 N 个节点）来对齐状态的。一旦你把某个 Hook 写进 `if` 里，导致某次 render 少调用（多调用也是同理）了一个：

- 第 N 次调用本该对应旧链表第 N 个节点
- 但因为前面少了一个，它实际拿到的是“别人”的节点（比如把 `useEffect` 的节点当成 `useState` 的来用）
- 状态、队列全部错位，轻则数据错乱，重则直接抛出上面那个 `Rendered more hooks...` 错误，生产环境爆炸（问，就是处理过别人写的条件式 hook……）

当然，我们可以多问一步“如果希望 hook 能支持条件式调用，又可以怎么处理”：本质上这是一个设计哲学的问题，而非科学或者理论上的无法实现，而最常见的实现思路有包括但不限于：hook 带 key、链表换 map……但都会带来额外的性能开销和心智负担。

所以可以更进一步地说：React 中不允许条件式调用 hook，是因为在它的概念中，hook 代表了一个组件的一份固定状态，无论发生了什么，一定会有这个状态。就类似于一辆车的轮子无论是什么品牌，一定会有轮子一样。

---

## useState 如何工作：Hook 对象、updateQueue、dispatch

有了链表机制，我们再把 `useState` 拆开看。它在 mount 和 update 两个阶段分别对应不同实现。

### mount：初始化 Hook，挂上 queue 和 dispatch

```tsx
// react-reconciler/src/ReactFiberHooks.js
function mountState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>] {
  // 1. 创建并接入这个 useState 对应的 Hook 节点
  const hook = mountWorkInProgressHook()

  // 2. 支持惰性初始化：useState(() => expensiveInit())
  if (typeof initialState === 'function') {
    initialState = initialState()
  }
  hook.memoizedState = hook.baseState = initialState

  // 3. 为这个 hook 建一个 updateQueue
  const queue: UpdateQueue<S, BasicStateAction<S>> = {
    pending: null,                 // 待处理 update 组成的环状链表（见下文）
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: basicStateReducer,  // useState 内部其实是用 reducer 实现的
    lastRenderedState: (initialState: any),
  }
  hook.queue = queue

  // 4. 生成 dispatch（也就是 setState），并把当前 fiber 和 queue 通过 bind 固定进去
  //    —— 这正是“函数组件没有实例，也能知道更新谁”的答案：靠闭包绑定
  const dispatch: Dispatch<BasicStateAction<S>> = (queue.dispatch = (dispatchSetState.bind(
    null,
    currentlyRenderingFiber,
    queue,
  ): any))

  return [hook.memoizedState, dispatch]
}
```

这里有两个值得停下来的点：

- `useState` 在内部是用 reducer 实现的，`basicStateReducer` 就是 `(state, action) => typeof action === 'function' ? action(state) : action`。这也解释了为什么 `setCount(c => c + 1)` 和 `setCount(5)` 都能工作。
- `dispatch` 通过 `bind` 把 `fiber` 和 `queue` 提前固定住了。所以哪怕函数组件没有 `this`，`setCount` 也始终知道“要往哪个 fiber、哪个 queue 上派发更新”。这就是函数组件版的“更新入口”。

### dispatch：setState 并不会立刻更新 state

```jsx
// react-reconciler/src/ReactFiberHooks.js
function dispatchSetState<S, A>(fiber: Fiber, queue: UpdateQueue<S, A>, action: A): void {
  const lane = requestUpdateLane(fiber)  // 这次更新的优先级（lanes，下一篇展开）

  // 构造一个 update 对象
  const update: Update<S, A> = {
    lane,
    action,                  // 你传给 setState 的参数，可以是值，也可以是一个参数
    hasEagerState: false,
    eagerState: null,
    next: (null: any),
  }

  // 把 update 入队（环状链表），然后调度一次更新
  const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane)
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, lane)  // 触发调度，最终走到下一次 render
  }
}
```

注意：`setState` 本身只做三件事——构造 update + 入队 + 请求调度，它完全不会同步地去改 `memoizedState`。这正是上一篇说的“`setState` 看起来异步”的本质：它只是把一次更新放进了一个更新队列里，真正应用到 Hook 上，是下一个环节的事情。

### update queue 为什么是环状链表

上面 `update.next` 和 `queue.pending` 构成的就是那条环状链表。入队逻辑大致是：

```jsx
// 简化版：把 update 接进 queue.pending 指向的环
if (queue.pending === null) {
  // 第一个 update：自己指向自己，形成环
  update.next = update
} else {
  // pending 始终指向“环的尾部”，pending.next 就是“环的头部”
  update.next = queue.pending.next  // 新节点的 next 指向头
  queue.pending.next = update       // 旧尾的 next 指向新节点
}
queue.pending = update              // pending 更新为新的尾
```

为什么要用环？因为这样只需要保存一个 `pending` 指针（指向尾），就能在 O(1) 时间内同时拿到**尾**（`pending`）和**头**（`pending.next`）：尾插方便，从头开始按顺序消费也方便。如果用普通单链表，要么尾插得每次遍历到末尾，要么得额外维护头尾两个指针。

### update：把队列里的 update 依次“跑”一遍，算出新 state

下一次 render 时，`useState` 走的是 `updateReducer`（`useState` 是它的特例）：

```jsx
// react-reconciler/src/ReactFiberHooks.js
function updateReducer<S, I, A>(reducer: (S, A) => S /* ... */): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook()  // 取回这个 hook（上面讲过）
  const queue = hook.queue

  // 取出待处理的环状队列
  const pending = queue.pending
  let newState = hook.baseState

  if (pending !== null) {
    // 从环的头部开始遍历（pending.next 是头）
    const first = pending.next
    let update = first
    do {
      const action = update.action
      // 关键：用 reducer 把上一个 state 和 action 折叠成新 state
      newState = reducer(newState, action)
      update = update.next
    } while (update !== first)  // 转一圈回到起点就停

    queue.pending = null  // 消费完清空
  }

  hook.memoizedState = newState  // 写回这个 hook 的最新 state
  hook.queue.lastRenderedState = newState
  const dispatch = queue.dispatch
  return [hook.memoizedState, dispatch]
}
```

这就完整闭环了：`setState` 把 action 入队 → 下一次 render 时 `updateReducer` 从头到尾把队列里的 action 用 reducer 依次折叠 → 得到新 state 写回 `hook.memoizedState` → 函数组件拿到新值。（真实源码这里还要处理 lane 优先级——低优先级的 update 会被跳过并记进 `baseQueue`，留到高优先级处理完再补算。这部分依赖 lanes 模型，我们放到下一篇讲。）

---

## Dispatcher 是什么：mount / update 阶段调用不同实现

你可能注意到了一个矛盾：我们写代码时永远只 `import { useState } from 'react'`，调的是同一个 `useState`，但我们上面却提到了 mount 和 update 两种阶段的不同逻辑，那它怎么知道自己现在该走 `mountState` 还是 `updateReducer`？

答案是 Dispatcher：React 维护了一个全局的“当前 Hooks 实现表”，在进入函数组件 render 前，根据是 mount 还是 update 切换这张表。

```jsx
// react/src/ReactHooks.js（useState 入口）
// react 包里我们 import 的 useState，其实只是去读“当前 dispatcher”
function useState(initialState) {
  const dispatcher = resolveDispatcher()
  return dispatcher.useState(initialState)
}

// react-reconciler/src/ReactFiberHooks.js（两套实现表）
// 两套实现表
const HooksDispatcherOnMount: Dispatcher = {
  useState: mountState,
  useEffect: mountEffect,
  useLayoutEffect: mountLayoutEffect,
  // ...
}
const HooksDispatcherOnUpdate: Dispatcher = {
  useState: updateState,        // 内部走 updateReducer
  useEffect: updateEffect,
  useLayoutEffect: updateLayoutEffect,
  // ...
}
```

切换发生在 `renderWithHooks` ——也就是 React 调用你这个函数组件的地方：

```jsx
// react-reconciler/src/ReactFiberHooks.js
function renderWithHooks(current, workInProgress, Component, props /* ... */) {
  currentlyRenderingFiber = workInProgress

  // 进入组件前先清空，准备重新构建 Hooks 链
  workInProgress.memoizedState = null
  workInProgress.updateQueue = null

  // 关键切换：current 为 null 且没有旧 Hooks ⇒ mount，否则 ⇒ update
  ReactCurrentDispatcher.current =
    current === null || current.memoizedState === null
      ? HooksDispatcherOnMount
      : HooksDispatcherOnUpdate

  // 真正调用你的函数组件——此时里面的 useState 会走对应实现
  let children = Component(props)

  // render 结束后换成一个会报错的 dispatcher，
  // 防止你在渲染之外（比如事件回调里）误调 Hook
  ReactCurrentDispatcher.current = ContextOnlyDispatcher

  // 重置指针
  currentHook = null
  workInProgressHook = null
  currentlyRenderingFiber = null
  return children
}
```

为什么用“全局切换 dispatcher”而不是在每个 `useState` 里自己 `if (mount) ... else ...`？好处主要有三个：

- 一是把“分阶段”这件事收口到一个地方，每个 Hook 实现本身保持单一职责；
- 二是开发模式下还能塞进第三套带检查的 dispatcher（检测你是否乱序调用、是否在条件里调用 Hook），不用污染正式实现；
- 三是 render 结束后切回 `ContextOnlyDispatcher`，能直接拦截“在组件外调用 Hook”的错误。

---

## useEffect / useLayoutEffect：在 render 阶段登记 effect，而不是立刻执行

最后简单看一下副作用类 Hook。这里只讲“登记 effect”，真正的执行时机属于 commit 阶段，留到副作用系统那篇展开。

其实和 `useState` 类似 `useEffect(fn)` 里的 `fn` 不会在 render 时执行。render 阶段做的只是把这个 effect“登记”到 fiber 上，并打一个 flag，等 commit 阶段再统一处理。

```jsx
// react-reconciler/src/ReactFiberHooks.js
function mountEffectImpl(fiberFlags, hookFlags, create, deps): void {
  const hook = mountWorkInProgressHook()  // effect 同样占用一个 Hook 节点
  const nextDeps = deps === undefined ? null : deps

  // 1. 给 fiber 打上副作用 flag（commit 阶段据此判断要不要处理这个 fiber）
  currentlyRenderingFiber.flags |= fiberFlags

  // 2. 把 effect 对象 push 到 fiber.updateQueue 上，并存进 hook.memoizedState
  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags,  // 标记“本次需要执行”
    create,                     // 你写的副作用函数
    createEffectInstance(),     // 用来存 destroy（清理函数）
    nextDeps,                   // 依赖数组
  )
}

// useEffect 与 useLayoutEffect 的差别，就在传入的两个 flag 上：
function mountEffect(create, deps) {
  // Passive：被动副作用，commit 之后异步执行（不阻塞浏览器绘制）
  return mountEffectImpl(PassiveEffect | PassiveStaticEffect, HookPassive, create, deps)
}
function mountLayoutEffect(create, deps) {
  // Layout：commit 中、DOM 变更后、浏览器绘制前同步执行
  return mountLayoutEffectImpl(UpdateEffect | LayoutStaticEffect, HookLayout, create, deps)
}
```

`pushEffect` 构造的 effect 对象，本身也是串成一条环状链表挂在 `fiber.updateQueue` 上：

```jsx
// react-reconciler/src/ReactFiberHooks.js
function pushEffect(tag, create, inst, deps) {
  const effect: Effect = { tag, create, inst, deps, next: (null: any) }
  let componentUpdateQueue = currentlyRenderingFiber.updateQueue
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFunctionComponentUpdateQueue()
    currentlyRenderingFiber.updateQueue = componentUpdateQueue
    effect.next = effect                       // 自环
    componentUpdateQueue.lastEffect = effect
  } else {
    const lastEffect = componentUpdateQueue.lastEffect
    // 同样的环状链表尾插套路
    const firstEffect = lastEffect.next
    lastEffect.next = effect
    effect.next = firstEffect
    componentUpdateQueue.lastEffect = effect
  }
  return effect
}
```

所以这里我们能看到两个 Hook 之间的呼应：

- `useState` 的更新挂在 hook.queue 上（每个 hook 一条环）
- `useEffect` 的 effect 挂在 fiber.updateQueue 上（整个组件一条环）

而 `useEffect` 和 `useLayoutEffect` 在 render 阶段核心差异主要体现在两个 flag（`Passive` vs `Layout`）上。这两个 flag 决定了它们在 commit 阶段的执行时机不同——一个在绘制前同步、一个在绘制后异步。这部分逻辑我们留到副作用系统那一篇再展开。

---

## 小结

回到开头那个反直觉的问题：函数组件只是个函数，为什么还能记住状态？现在答案已经很完整了：

- 状态不在函数里，而在它对应的 FiberNode 的 `memoizedState` 上，以一条 Hooks 链表的形式存在；
- 多个 Hook 靠调用顺序与链表节点一一对应，update 阶段通过 `currentHook` / `workInProgressHook` 两个指针按位置逐个取回旧节点——这就是“Hooks 必须按固定顺序调用”这条规则的原因；
- `useState` 的 `setState` 并不直接改状态，而是构造 update 入队（环状链表），下一次 render 时用 reducer 把队列折叠出新 state；
- 同一个 `useState` 之所以能在 mount / update 走不同实现，是因为 React 在 `renderWithHooks` 里通过 Dispatcher 全局切换了 Hooks 实现表；
- `useEffect` / `useLayoutEffect` 在 render 阶段只负责登记 effect 并打 flag，真正执行要等 commit。

至此，函数组件不再是个黑盒：它的状态有了明确的归属（Fiber），更新有了明确的入口（bind 进 dispatch 的 fiber/queue），多次 render 之间靠链表顺序对齐。当然，我们引入了一个新的概念：更新队列，下一篇，我们展开来讲 React 是如何处理这些“嗷嗷待哺”的更新的，也就是 Scheduler 和 Lanes 这两个概念。
