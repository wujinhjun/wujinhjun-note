# FiberNode：React 内核中的工作单元

前两篇文章聊完了两件事：一是 React 为什么非要从 Stack Reconciler 向 Fiber 演进，二是 Fiber 这套架构在概念层面试图解决什么问题。

但聊到这里，Fiber 其实还只是一个架构层的描述。现在该追一个更具体的问题了：React 到底用什么样的数据结构来承载相关功能？

答案自然就是本篇的主角，也是 React 的核心数据结构之一：FiberNode。

## 组件和 FiberNode 的关系

我们平时写 React，最熟悉的是组件。一个 `App`，一个 `Header`，一个 `Button`，这些是开发者视角下的组织单位。但组件只是一种声明 UI 的方式，它并不直接参与 React 内部的调度和更新，这一点在前言篇里提过了。

真正被 React 拿来当作"work unit"推进的，是 FiberNode。

我们写下的每一个组件、每一个宿主节点（比如 `div`、`ul`），在 React 的运行时里都会对应一个 FiberNode。它不只是树里的一个点，它还持有这个节点的状态、更新队列、副作用标记、优先级信息……可以说，React 对于掌控每一个节点所需要的信息，都挂载在对应的 FiberNode 上（好抽象一句话）。

如果说 ReactElement  这个 UI 描述符是"开发者希望这里渲染什么"，那 FiberNode 解决的就是"React 该怎么把这种预期一步步落到宿主环境里"。

## 从 ReactElement 到 FiberNode

既然组件和 FiberNode 是两码事，那 React 是怎么从一个过渡到另一个的？

我们写 JSX，实际上是 `React.createElement` 的语法糖，产物是一个 ReactElement——一个不可变的普通对象（plain object, 我们也可以借用 flutter 的概念，称之为 UI 描述符），描述的是"这里应该渲染什么"。但 ReactElement 自己不参与调度，也不持有状态，它就像是一个目标图纸，只描绘，不实施。

真正的转化发生在 React 的内部：

- **首次挂载时**，React 会通过 `createFiberFromElement` 把 ReactElement 转换成一个 FiberNode。这个过程会根据 element 的 type（函数、类、字符串标签……）决定 Fiber 的 tag，把 props 挂到 `pendingProps` 上，把 key 传进去，一个全新的 work unit 就诞生了。
- **更新时**，React 并不会每次都从头创建新的 Fiber。它会通过 `createWorkInProgress` 复用当前 Fiber 的 `alternate`——如果 alternate 已经存在，就直接重置它的 props 和 flags，避免反复分配内存。这也是双缓冲机制在创建层面的体现：旧的 Fiber 不会被丢掉，而是被回收为下一轮的草稿。

这里有一个值得注意的区别：ReactElement 是不可变的，每次 render 都会产生新的 element 树；而 FiberNode 是可变的，它会在多次更新中被反复复用和修改。正是因为 FiberNode 可变与复用，状态、副作用、优先级这些运行时信息才有地方挂载。

## FiberRootNode 与 HostRoot

在继续看 FiberNode 的组成之前，有两个容易混淆的概念需要先厘清：FiberRootNode 和 HostRoot。

- FiberRootNode 是整个 React 应用的容器对象。我们调用 `createRoot(document.getElementById('root'))` 时，React 在内部创建的就是它。它不是 Fiber 树的一部分，而是 Fiber 树的"管理者"，持有 `current`（当前 Fiber 树的根）、`pendingLanes`（待处理的优先级）、`finishedWork`（本轮 render 完成的结果）等全局状态。
- HostRoot 则是 Fiber 树真正的根节点，它的 `tag === HostRoot`。它是第一个 FiberNode，是 Fiber 树遍历的起点。

两者通过一对互引建立联系：`fiberRootNode.current` 指向 HostRoot Fiber，`hostRootFiber.stateNode` 指回 FiberRootNode。理解这层关系，后面看 render 和 commit 的入口时就不会懵。

## FiberNode 的组成

那 FiberNode 既然是一个数据结构，里面又有哪些数据属性呢？

1. 节点的元数据：它虽然并不是直观意义上的 UI 节点，但它实际上持有了 UI 节点的元数据，所以它实质上也拥有 UI 节点的信息，比如这个 Fiber 对应什么样的元素、什么种类、有没有 key……
2. 指针数据：这一点很好理解，我们在上一篇中讨论了大量内容，是关于 React 如何通过 Fiber 架构从 JS 递归调用栈收回控制权的，其中实现的方法，就是把隐式的调用变成了显式的指针，所以 FiberNode 中一定存在相关的指针：指向父节点、子节点、兄弟节点……
3. 状态与输入：既然 Fiber 是 React 运行时的载体，那组件的状态总得有个地方进行存储。函数组件本身是纯函数，不持有状态，但我们调用 `useState`、`useReducer` 的时候，状态确确实实存在了——因为它们就挂在 FiberNode 上。除了状态本身，还有"这次更新要用什么 props"、"上一次渲染用的是什么 props"、"有没有排队等待处理的更新"……这些信息都需要被 FiberNode 持有，否则 React 在 render 阶段就没法判断"要不要重新计算这个节点"。
4. 副作用标记：React 的一个核心设计理念是：render 阶段只做计算，commit 阶段才做真正的 副作用操作。那么，render 阶段算出来的是"哪些节点需要插入、哪些需要更新、哪些需要删除"，这些结论存在哪里？答案是 FiberNode 上的 flags。每个 Fiber 在 render 阶段被处理完之后，会被打上对应的副作用标记，等到 commit 阶段统一读取执行。此外还有一个 `subtreeFlags`，它是子树中所有 flags 的合集，作用是让 commit 阶段可以快速跳过"整棵子树都没有副作用"的情况，避免无意义的遍历。
5. 调度信息：在上一篇里我们也提到了，Fiber 架构的一个核心目标是"可排序"——不同更新有不同的优先级。那优先级信息挂在哪里？还是 FiberNode。使用 lanes 模型来表达优先级，每个 Fiber 上都有 `lanes` 和 `childLanes` 两个字段。`lanes` 表示当前节点自身有哪些待处理的更新，`childLanes` 则表示子树中是否还有未完成的工作。这两个字段配合起来，让 React 在遍历过程中可以快速判断"这个节点需不需要进入、子树还有没有活要干"，从而实现更高效的剪枝。当然，lanes 模型本身的设计非常精妙，我们留到 Scheduler 那一篇再展开。
6. 双缓冲指针：这是 Fiber 架构中最关键的设计之一——`alternate`。这个字段指向当前 Fiber 的"另一个版本"。React 在任意时刻最多维护两棵 Fiber 树：`current`（当前屏幕上的状态）和 `workInProgress`（正在计算的下一次更新），它们通过 `alternate` 互相指向对方。为什么需要两棵树？因为 render 可中断。如果只有一棵树，render 做到一半被打断，树上已经改了一部分——旧的被覆盖、新的没算完，界面就会不一致。有了双缓冲，render 阶段所有计算都发生在 workInProgress 树上，UI 不变。只有整轮 render 完成、进入 commit 后，React 才执行一次指针切换：`root.current = finishedWork`。这就是上一篇说的"render 可中断、commit 不可中断"在数据结构上的直接体现。熟悉 GPU 渲染管线的朋友应该发现了，这和 front buffer / back buffer 是同源的思想。

以上六组数据，就是 FiberNode 的核心组成。下面我们直接看 React 的源码，把这些概念和真实的字段对应起来。

### 源码对照：FiberNode 构造函数

以下代码来自 React 19 的 `react-reconciler/src/ReactFiber.js`，是 `FiberNode` 构造函数的核心部分：

```jsx
function FiberNode(
  this: $FlowFixMe,
  tag: WorkTag,
  pendingProps: mixed,
  key: null | string,
  mode: TypeOfMode,
) {
  // ========== 1. 节点元数据（身份信息）==========
  this.tag = tag;                    // 节点类型：FunctionComponent、HostComponent、HostRoot……
  this.key = key;                    // 用于 diff 的 key
  this.elementType = null;           // createElement 的第一个参数（大多数情况下和 type 相同）
  this.type = null;                  // 函数组件就是函数本身，class 组件就是 class，宿主节点就是标签名字符串
  this.stateNode = null;             // 指向真实宿主实例（DOM 节点）、class 实例、或 FiberRootNode

  // ========== 2. 指针数据（树结构）==========
  this.return = null;                // 父节点
  this.child = null;                 // 第一个子节点
  this.sibling = null;               // 下一个兄弟节点
  this.index = 0;                    // 在兄弟节点中的位置索引

  this.ref = null;                   // ref 引用
  this.refCleanup = null;            // React 19 新增：ref 的清理回调（支持 ref cleanup 函数）

  // ========== 3. 状态与输入 ==========
  this.pendingProps = pendingProps;   // 本次更新待处理的 props
  this.memoizedProps = null;         // 上一次渲染使用的 props
  this.updateQueue = null;           // 更新队列（setState、forceUpdate 产生的 update 链表）
  this.memoizedState = null;         // 上一次渲染的 state（函数组件中，这里挂的是 Hooks 链表）
  this.dependencies = null;          // context 依赖

  this.mode = mode;                  // 模式标记（ConcurrentMode、StrictMode 等）

  // ========== 4. 副作用标记 ==========
  this.flags = NoFlags;              // 当前节点的副作用标记（Placement、Update、Deletion……）
  this.subtreeFlags = NoFlags;       // 子树中所有副作用的合集，用于 commit 阶段快速剪枝
  this.deletions = null;             // 需要被删除的子 Fiber 数组

  // ========== 5. 调度信息 ==========
  this.lanes = NoLanes;              // 当前节点上挂载的更新对应的优先级
  this.childLanes = NoLanes;         // 子树中是否还有待处理的更新

  // ========== 6. 双缓冲指针 ==========
  this.alternate = null;             // 指向 current ↔ workInProgress 的另一个版本
}
```

值得一提的是，React 19 在这个构造函数之外还引入了 `enableObjectFiber` 开关。当开启时，`createFiber` 会使用对象字面量（`createFiberImplObject`）而非 `new FiberNode()` 来创建 Fiber，目的是在非 JIT 环境下获得更好的性能——但字段是完全一样的。所以无论哪种创建方式，我们前面讨论的六组数据，在源码里都是一一对应的。当然，如果有熟悉 Sentry 的朋友也会发现，通过工厂方法来调用在 Sentry 中也是十分的常见。关于这一点，我们后面有机会再进行展开（挖坑ing）

整个 FiberNode 并不复杂，但它承载了 React 运行时几乎所有关键的上下文信息。

## 小结

到这里，我们已经把 FiberNode 从概念到结构完整地过了一遍。回过头来，可以把第一篇提出的五个能力和本篇的字段做一次对应：

- **可中断 / 可恢复**：`child` / `sibling` / `return` 三指针让遍历变成 React 自主控制的迭代过程，随时可以停在某个节点上
- **可重试**：`alternate` 双缓冲保证了 render 做到一半被丢弃也不会污染当前界面
- **可排序**：`lanes` / `childLanes` 让每个节点都携带优先级信息，Scheduler 可以据此决定先做谁
- **render / commit 分离**：`flags` / `subtreeFlags` 在 render 阶段收集副作用，commit 阶段统一执行
- **状态持有**：`memoizedState` / `updateQueue` / `pendingProps` / `memoizedProps` 让函数组件这种"纯函数"也能拥有状态

从抽象到结构，Fiber 架构的设计意图终于落到了具体的数据字段上。

但到目前为止，我们还只是在看"FiberNode 长什么样"。依然不能解释：一个纯函数，怎么样拥有状态。所以下一篇要追问的是：挂在 `memoizedState` 上的 Hooks 链表到底是怎么工作的？`useState` 和 `useEffect` 在 Fiber 内部又是如何被串起来的？
