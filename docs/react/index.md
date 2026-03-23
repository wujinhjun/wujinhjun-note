# React 笔记

React 相关技术文章与学习记录。

这一系列文章不会讲 React 的基础用法，更不是面向新手的入门教程。它主要关心于 React 到底在解决什么问题，以及 React 为了实现这些目标，设计了怎样的数据结构、调度模型和执行流程。

不过在正式深入探讨 React 与 Fiber 架构之前，我还是希望先写一篇前言篇。它不会深入源码细节，而是用来交代我为什么想写这系列文章、准备讨论哪些问题，以及在进入到 React 世界探险前，我们需要定好哪些概念坐标，以防走失。

文章会围绕一条主线展开：

一次 React 更新，究竟是如何从“产生”，到“被调度”，再到“构造新树”，最后“提交到页面”的？

如果只有零散概念，比如 Fiber、lanes、diff、hooks、commit，难免雾里看花，很难真正理解 React。只有把这些概念放回同一条 workflow 里，才能看清 React 的设计哲学：哪些阶段可以中断，哪些阶段必须原子；哪些信息存放在 FiberNode 上，哪些信息通过副作用系统向后传递；React 又是如何在性能、响应性和一致性之间做工程取舍的。

因此，这个系列会从 Fiber 出发，依次展开 React 的核心 workflow。

## 目录

* [前言篇：为什么我要写这一组 React 文章](./0-preface.md)

  突然发现不知不觉间，自己已经从一个 HCI 背景的 designer 变成了一个合格的前端工程师，对于 React 的理解也已经从简单的写 jsx 变成了对 Fiber 架构也是略懂一二的人，所以我想借此机会，梳理一下自己的概念，一方面帮助自己更好的理清思路，另一方面，也希望能够帮助到各位

* [React 为什么必须重写为 Fiber - WIP](./1-why-react-needs-fiber.md)

  从 Stack Reconciler 的局限讲起，解释为什么 React 需要可中断、可恢复、可排序的更新模型。Fiber 不是一次普通的性能优化，而是为了调度能力而进行的架构大迭代。

* [FiberNode：React 内核中的工作单元 - WIP](./what-is-a-fiber-node.md)

  这一篇会拆开 FiberNode 的关键字段，说明它为什么同时承载了树结构、组件状态、优先级信息和副作用标记。理解 FiberNode，才能真正理解 React 为什么能把“递归组件树”改造成“可调度的工作单元”。

* [Hooks: React 如何在函数组件中保存状态和副作用 - WIP](./what-is-hooks.md)

  函数组件没有 `this`、也没有类实例，状态与「上一次渲染留下的信息」却必须在多次调用之间保持一致。这篇会从运行时视角说明：Hooks 如何通过固定的调用顺序与 Fiber 上的 `memoizedState` 链表对齐，Dispatcher 如何在 render 与 commit 之间切换语义，以及 `useEffect` / `useLayoutEffect` 这类 API 为何被设计成「在 render 里声明、在提交链路里执行」。

* [Scheduler 与 Lanes：React 如何决定谁先更新 - WIP](./scheduler-and-lanes.md)

  React 不会把所有更新一视同仁。用户输入、过渡更新、空闲任务有不同的紧急程度，这篇会从调度视角解释 lanes 的意义，以及 React 如何组织优先级、避免饥饿并推动整棵树向前执行。

* [Reconciler：React 如何构造下一棵树 - WIP](./how-reconciler-works.md)

  render 阶段的本质不是“直接改 DOM”，而是遍历 Fiber 树并构造 workInProgress 树。这篇会串起 beginWork、completeWork、bailout 与双缓存树，说明 React 如何把一次更新拆成可中断的增量计算过程。

* [Children Diff：节点复用、移动与 Key 的本质 - WIP](./children-diff.md)

  children diff 是 React 协调过程里最容易被误解的部分。这里不会停留在“key 很重要”这种层面，而是会进一步分析 React 如何处理单节点、多节点、插入、删除和移动，以及它为什么选择启发式算法而不是最优算法。

* [副作用系统：React 如何描述一次界面变更 - WIP](./effect-flags-and-side-effects.md)

  render 阶段不会直接执行 DOM 操作，而是收集副作用。这篇会解释 Placement、Update、Deletion、Passive、Layout 等副作用是如何被编码和聚合的，以及 React 为什么要先生成一份“变更说明书”，再统一进入提交阶段。

* [Commit 阶段：为什么最终提交不能中断 - WIP](./why-commit-cannot-be-interrupted.md)

  render 可以中断，commit 不能中断。这不是限制，而是 React 为了一致性做出的主动选择。这篇会分析 before mutation、mutation、layout 三个子阶段，以及 DOM、ref、layout effect、passive effect 之间的执行时序和设计原因。

* [番外：React 的第三方库实现 - WIP](./third-party-libraries.md)

  主线讲完内核之后，这篇从**生态**侧收尾：会拆解一些有趣的第三方库，来分析它们是如何在 React 的基础上进行的生态拓展

## 为什么先写前言篇

如果一上来就进入 Fiber、lanes、Reconciler、flags 和 commit，确实能很快进入“硬核内容”，但也会带来一个问题：读者容易在概念上失去坐标，只记住局部机制，却不知道这些机制究竟在 React 整体模型中扮演什么角色。

所以前言篇不会追求深度，而是追求建立坐标。它主要会做三件事：

* 先解释这套文章为什么要写，以及它和普通 React 教程的区别。

* 用较低门槛的方式介绍 React 的整体运行模型，让后面的内核分析有共同语境。

* 先把一些高频核心概念讲清楚，避免后续文章不断回头补定义。

前言篇里会简单涉及的概念包括：

* React 到底是什么，它解决了什么问题。

* 组件、ReactElement、FiberNode 分别处在什么层次。

* render、reconcile、commit 这几个词分别是什么意思。

## 这套文章想回答什么

如果用一句话概括，这套文章想回答的是：

React 如何把一次更新，拆成一个可中断、可恢复、可排序，但最终又能够保持一致性的过程。

围绕这个问题，我们会逐步回答：

* React 的整体工作流到底是什么，后续所有机制分别处在什么位置。

* 为什么 React 需要 Fiber，而不是继续沿用递归调用栈。

* FiberNode 到底是什么，它为什么能承载 React 运行时的核心信息。

* React 如何为不同更新分配优先级，并决定谁先执行。

* React 如何在 render 阶段构造新树，并尽量跳过不必要的遍历。

* React 如何在 children diff 中处理复用、插入、删除和移动。

* React 如何用副作用系统表达变更，而不是在 render 阶段直接操作真实界面。

* 为什么最终的 commit 阶段必须保持原子性，不能像 render 那样被打断。

## 写作方式

这个系列不会按“源码文件导读”的方式机械展开，也不会只罗列 API 和概念。前言篇会先建立一个概念坐标系，后面的文章再逐步进入 React 设计哲学。每一篇都会先讨论 React 在做什么，在解决什么问题，再落到具体的数据结构和执行流程，最后回到设计取舍本身。

我在这里更关心的问题是：

* React 为什么要这样设计，而不是它恰好这样实现。

* 某个机制解决了什么问题，又引入了什么代价。

* 当 Fiber、Scheduler、Reconciler、Effects、Commit 被放回同一条链路中时，它们之间到底是怎样协作的。
