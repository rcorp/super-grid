require({cache:{
'dgrid/List':function(){
define([
	'dojo/_base/declare',
	'dojo/on',
	'dojo/has',
	'./util/misc',
	'xstyle/has-class',
	'put-selector/put',
	'dojo/_base/sniff',
	'xstyle/css!./css/dgrid.css'
], function (declare, listen, has, miscUtil, hasClass, put) {
	// Add user agent/feature CSS classes
	hasClass('mozilla', 'touch');

	// Add a feature test for pointer (only Dojo 1.10 has pointer-events and MSPointer tests)
	has.add('pointer', function (global) {
		return 'PointerEvent' in global ? 'pointer' :
			'MSPointerEvent' in global ? 'MSPointer' : false;
	});

	var oddClass = 'dgrid-row-odd',
		evenClass = 'dgrid-row-even',
		scrollbarWidth, scrollbarHeight;

	function byId(id) {
		return document.getElementById(id);
	}

	function cleanupTestElement(element) {
		element.className = '';
		if (element.parentNode) {
			document.body.removeChild(element);
		}
	}

	function getScrollbarSize(element, dimension) {
		// Used by has tests for scrollbar width/height
		put(document.body, element, '.dgrid-scrollbar-measure');
		var size = element['offset' + dimension] - element['client' + dimension];
		cleanupTestElement(element);
		return size;
	}
	has.add('dom-scrollbar-width', function (global, doc, element) {
		return getScrollbarSize(element, 'Width');
	});
	has.add('dom-scrollbar-height', function (global, doc, element) {
		return getScrollbarSize(element, 'Height');
	});

	has.add('dom-rtl-scrollbar-left', function (global, doc, element) {
		var div = put('div'),
			isLeft;

		put(document.body, element, '.dgrid-scrollbar-measure[dir=rtl]');
		put(element, div);

		// position: absolute makes IE always report child's offsetLeft as 0,
		// but it conveniently makes other browsers reset to 0 as base, and all
		// versions of IE are known to move the scrollbar to the left side for rtl
		isLeft = !! 10  || !!has('trident') || div.offsetLeft >= has('dom-scrollbar-width');
		cleanupTestElement(element);
		put(div, '!');
		element.removeAttribute('dir');
		return isLeft;
	});

	// var and function for autogenerating ID when one isn't provided
	var autogen = 0;
	function generateId() {
		return 'dgrid_' + autogen++;
	}

	// common functions for class and className setters/getters
	// (these are run in instance context)
	var spaceRx = / +/g;
	function setClass(cls) {
		// Format input appropriately for use with put...
		var putClass = cls ? '.' + cls.replace(spaceRx, '.') : '';

		// Remove any old classes, and add new ones.
		if (this._class) {
			putClass = '!' + this._class.replace(spaceRx, '!') + putClass;
		}
		put(this.domNode, putClass);

		// Store for later retrieval/removal.
		this._class = cls;
	}
	function getClass() {
		return this._class;
	}

	// window resize event handler, run in context of List instance
	var winResizeHandler = function () {
		if (this._started) {
			this.resize();
		}
	};

	return declare(null, {
		tabableHeader: false,

		// showHeader: Boolean
		//		Whether to render header (sub)rows.
		showHeader: false,

		// showFooter: Boolean
		//		Whether to render footer area.  Extensions which display content
		//		in the footer area should set this to true.
		showFooter: false,

		// maintainOddEven: Boolean
		//		Whether to maintain the odd/even classes when new rows are inserted.
		//		This can be disabled to improve insertion performance if odd/even styling is not employed.
		maintainOddEven: true,

		// cleanAddedRules: Boolean
		//		Whether to track rules added via the addCssRule method to be removed
		//		when the list is destroyed.  Note this is effective at the time of
		//		the call to addCssRule, not at the time of destruction.
		cleanAddedRules: true,

		// addUiClasses: Boolean
		//		Whether to add jQuery UI classes to various elements in dgrid's DOM.
		addUiClasses: true,

		// highlightDuration: Integer
		//		The amount of time (in milliseconds) that a row should remain
		//		highlighted after it has been updated.
		highlightDuration: 250,

		postscript: function (params, srcNodeRef) {
			// perform setup and invoke create in postScript to allow descendants to
			// perform logic before create/postCreate happen (a la dijit/_WidgetBase)
			var grid = this;

			(this._Row = function (id, object, element) {
				this.id = id;
				this.data = object;
				this.element = element;
			}).prototype.remove = function () {
				grid.removeRow(this.element);
			};

			if (srcNodeRef) {
				// normalize srcNodeRef and store on instance during create process.
				// Doing this in postscript is a bit earlier than dijit would do it,
				// but allows subclasses to access it pre-normalized during create.
				this.srcNodeRef = srcNodeRef =
					srcNodeRef.nodeType ? srcNodeRef : byId(srcNodeRef);
			}
			this.create(params, srcNodeRef);
		},
		listType: 'list',

		create: function (params, srcNodeRef) {
			var domNode = this.domNode = srcNodeRef || put('div'),
				cls;

			if (params) {
				this.params = params;
				declare.safeMixin(this, params);

				// Check for initial class or className in params or on domNode
				cls = params['class'] || params.className || domNode.className;
			}

			// ensure arrays and hashes are initialized
			this.sort = this.sort || [];
			this._listeners = [];
			this._rowIdToObject = {};

			this.postMixInProperties && this.postMixInProperties();

			// Apply id to widget and domNode,
			// from incoming node, widget params, or autogenerated.
			this.id = domNode.id = domNode.id || this.id || generateId();

			// Perform initial rendering, and apply classes if any were specified.
			this.buildRendering();
			if (cls) {
				setClass.call(this, cls);
			}

			this.postCreate();

			// remove srcNodeRef instance property post-create
			delete this.srcNodeRef;
			// to preserve "it just works" behavior, call startup if we're visible
			if (this.domNode.offsetHeight) {
				this.startup();
			}
		},
		buildRendering: function () {
			var domNode = this.domNode,
				addUiClasses = this.addUiClasses,
				self = this,
				headerNode, bodyNode, footerNode, isRTL;

			// Detect RTL on html/body nodes; taken from dojo/dom-geometry
			isRTL = this.isRTL = (document.body.dir || document.documentElement.dir ||
				document.body.style.direction).toLowerCase() === 'rtl';

			// Clear out className (any pre-applied classes will be re-applied via the
			// class / className setter), then apply standard classes/attributes
			domNode.className = '';

			put(domNode, '[role=grid].dgrid.dgrid-' + this.listType +
				(addUiClasses ? '.ui-widget' : ''));

			// Place header node (initially hidden if showHeader is false).
			headerNode = this.headerNode = put(domNode,
				'div.dgrid-header.dgrid-header-row' +
				(addUiClasses ? '.ui-widget-header' : '') +
				(this.showHeader ? '' : '.dgrid-header-hidden'));
			bodyNode = this.bodyNode = put(domNode, 'div.dgrid-scroller');

			// Firefox 4+ adds overflow: auto elements to the tab index by default;
			// force them to not be tabbable, but restrict this to Firefox,
			// since it breaks accessibility support in other browsers
			if (has('ff')) {
				bodyNode.tabIndex = -1;
			}

			this.headerScrollNode = put(domNode, 'div.dgrid-header.dgrid-header-scroll.dgrid-scrollbar-width' +
				(addUiClasses ? '.ui-widget-header' : ''));

			// Place footer node (initially hidden if showFooter is false).
			footerNode = this.footerNode = put('div.dgrid-footer' +
				(this.showFooter ? '' : '.dgrid-footer-hidden'));
			put(domNode, footerNode);

			if (isRTL) {
				domNode.className += ' dgrid-rtl' +
					(has('dom-rtl-scrollbar-left') ? ' dgrid-rtl-swap' : '');
			}

			listen(bodyNode, 'scroll', function (event) {
				if (self.showHeader) {
					// keep the header aligned with the body
					headerNode.scrollLeft = event.scrollLeft || bodyNode.scrollLeft;
				}
				// re-fire, since browsers are not consistent about propagation here
				event.stopPropagation();
				listen.emit(domNode, 'scroll', {scrollTarget: bodyNode});
			});
			this.configStructure();
			this.renderHeader();

			this.contentNode = this.touchNode = put(this.bodyNode,
				'div.dgrid-content' + (addUiClasses ? '.ui-widget-content' : ''));
			// add window resize handler, with reference for later removal if needed
			this._listeners.push(this._resizeHandle = listen(window, 'resize',
				miscUtil.throttleDelayed(winResizeHandler, this)));
		},

		postCreate: function () {
		},

		startup: function () {
			// summary:
			//		Called automatically after postCreate if the component is already
			//		visible; otherwise, should be called manually once placed.

			if (this._started) {
				return;
			}
			this.inherited(arguments);
			this._started = true;
			this.resize();
			// apply sort (and refresh) now that we're ready to render
			this.set('sort', this.sort);
		},

		configStructure: function () {
			// does nothing in List, this is more of a hook for the Grid
		},
		resize: function () {
			var bodyNode = this.bodyNode,
				headerNode = this.headerNode,
				footerNode = this.footerNode,
				headerHeight = headerNode.offsetHeight,
				footerHeight = this.showFooter ? footerNode.offsetHeight : 0;

			this.headerScrollNode.style.height = bodyNode.style.marginTop = headerHeight + 'px';
			bodyNode.style.marginBottom = footerHeight + 'px';

			if (!scrollbarWidth) {
				// Measure the browser's scrollbar width using a DIV we'll delete right away
				scrollbarWidth = has('dom-scrollbar-width');
				scrollbarHeight = has('dom-scrollbar-height');

				// Avoid issues with certain widgets inside in IE7, and
				// ColumnSet scroll issues with all supported IE versions
				if ( 10 ) {
					scrollbarWidth++;
					scrollbarHeight++;
				}

				// add rules that can be used where scrollbar width/height is needed
				miscUtil.addCssRule('.dgrid-scrollbar-width', 'width: ' + scrollbarWidth + 'px');
				miscUtil.addCssRule('.dgrid-scrollbar-height', 'height: ' + scrollbarHeight + 'px');

				if (scrollbarWidth !== 17) {
					// for modern browsers, we can perform a one-time operation which adds
					// a rule to account for scrollbar width in all grid headers.
					miscUtil.addCssRule('.dgrid-header-row', 'right: ' + scrollbarWidth + 'px');
					// add another for RTL grids
					miscUtil.addCssRule('.dgrid-rtl-swap .dgrid-header-row', 'left: ' + scrollbarWidth + 'px');
				}
			}
		},

		addCssRule: function (selector, css) {
			// summary:
			//		Version of util/misc.addCssRule which tracks added rules and removes
			//		them when the List is destroyed.

			var rule = miscUtil.addCssRule(selector, css);
			if (this.cleanAddedRules) {
				// Although this isn't a listener, it shares the same remove contract
				this._listeners.push(rule);
			}
			return rule;
		},

		on: function (eventType, listener) {
			// delegate events to the domNode
			var signal = listen(this.domNode, eventType, listener);
			if (!has('dom-addeventlistener')) {
				this._listeners.push(signal);
			}
			return signal;
		},

		cleanup: function () {
			// summary:
			//		Clears out all rows currently in the list.

			var i;
			for (i in this._rowIdToObject) {
				if (this._rowIdToObject[i] !== this.columns) {
					var rowElement = byId(i);
					if (rowElement) {
						this.removeRow(rowElement, true);
					}
				}
			}
		},
		destroy: function () {
			// summary:
			//		Destroys this grid

			// Remove any event listeners and other such removables
			if (this._listeners) { // Guard against accidental subsequent calls to destroy
				for (var i = this._listeners.length; i--;) {
					this._listeners[i].remove();
				}
				this._listeners = null;
			}

			this._started = false;
			this.cleanup();
			// destroy DOM
			put(this.domNode, '!');
		},
		refresh: function () {
			// summary:
			//		refreshes the contents of the grid
			this.cleanup();
			this._rowIdToObject = {};
			this._autoId = 0;

			// make sure all the content has been removed so it can be recreated
			this.contentNode.innerHTML = '';
			// Ensure scroll position always resets (especially for TouchScroll).
			this.scrollTo({ x: 0, y: 0 });
		},

		highlightRow: function (rowElement, delay) {
			// summary:
			//		Highlights a row.  Used when updating rows due to store
			//		notifications, but potentially also useful in other cases.
			// rowElement: Object
			//		Row element (or object returned from the row method) to
			//		highlight.
			// delay: Number
			//		Number of milliseconds between adding and removing the
			//		ui-state-highlight class.

			rowElement = rowElement.element || rowElement;
			put(rowElement, '.dgrid-highlight' +
				(this.addUiClasses ? '.ui-state-highlight' : ''));
			setTimeout(function () {
				put(rowElement, '!dgrid-highlight!ui-state-highlight');
			}, delay || this.highlightDuration);
		},

		adjustRowIndices: function (firstRow) {
			// this traverses through rows to maintain odd/even classes on the rows when indexes shift;
			var next = firstRow;
			var rowIndex = next.rowIndex;
			if (rowIndex > -1) { // make sure we have a real number in case this is called on a non-row
				do {
					// Skip non-numeric, non-rows
					if (next.rowIndex > -1) {
						if (this.maintainOddEven) {
							if ((next.className + ' ').indexOf('dgrid-row ') > -1) {
								put(next, '.' + (rowIndex % 2 === 1 ? oddClass : evenClass) + '!' +
									(rowIndex % 2 === 0 ? oddClass : evenClass));
							}
						}
						next.rowIndex = rowIndex++;
					}
				} while ((next = next.nextSibling) && next.rowIndex !== rowIndex);
			}
		},
		renderArray: function (results, beforeNode, options) {
			// summary:
			//		Renders an array of objects as rows, before the given node.

			options = options || {};
			var self = this,
				start = options.start || 0,
				rowsFragment = document.createDocumentFragment(),
				rows = [],
				container,
				i = 0,
				len = results.length;

			if (!beforeNode) {
				this._lastCollection = results;
			}

			// Insert a row for each item into the document fragment
			while (i < len) {
				rows[i] = this.insertRow(results[i], rowsFragment, null, start++, options);
				i++;
			}

			// Insert the document fragment into the appropriate position
			container = beforeNode ? beforeNode.parentNode : self.contentNode;
			if (container && container.parentNode &&
					(container !== self.contentNode || len)) {
				container.insertBefore(rowsFragment, beforeNode || null);
				if (len) {
					self.adjustRowIndices(rows[len - 1]);
				}
			}

			return rows;
		},

		renderHeader: function () {
			// no-op in a plain list
		},

		_autoId: 0,
		insertRow: function (object, parent, beforeNode, i, options) {
			// summary:
			//		Creates a single row in the grid.

			// Include parentId within row identifier if one was specified in options.
			// (This is used by tree to allow the same object to appear under
			// multiple parents.)
			var id = this.id + '-row-' + ((this.collection && this.collection.getIdentity) ?
					this.collection.getIdentity(object) : this._autoId++),
				row = byId(id),
				previousRow = row && row.previousSibling;

			if (row) {
				// If it existed elsewhere in the DOM, we will remove it, so we can recreate it
				if (row === beforeNode) {
					beforeNode = (beforeNode.connected || beforeNode).nextSibling;
				}
				this.removeRow(row);
			}
			row = this.renderRow(object, options);
			row.className = (row.className || '') + ' dgrid-row ' +
				(i % 2 === 1 ? oddClass : evenClass) +
				(this.addUiClasses ? ' ui-state-default' : '');
			// Get the row id for easy retrieval
			this._rowIdToObject[row.id = id] = object;
			parent.insertBefore(row, beforeNode || null);

			row.rowIndex = i;
			if (previousRow && previousRow.rowIndex !== (row.rowIndex - 1)) {
				// In this case, we are pulling the row from another location in the grid,
				// and we need to readjust the rowIndices from the point it was removed
				this.adjustRowIndices(previousRow);
			}
			return row;
		},
		renderRow: function (value) {
			// summary:
			//		Responsible for returning the DOM for a single row in the grid.
			// value: Mixed
			//		Value to render
			// options: Object?
			//		Optional object with additional options

			return put('div', '' + value);
		},
		removeRow: function (rowElement, preserveDom) {
			// summary:
			//		Simply deletes the node in a plain List.
			//		Column plugins may aspect this to implement their own cleanup routines.
			// rowElement: Object|DOMNode
			//		Object or element representing the row to be removed.
			// preserveDom: Boolean?
			//		If true, the row element will not be removed from the DOM; this can
			//		be used by extensions/plugins in cases where the DOM will be
			//		massively cleaned up at a later point in time.
			// options: Object?
			//		May be specified with a `rows` property for the purpose of
			//		cleaning up collection tracking (used by `_StoreMixin`).

			rowElement = rowElement.element || rowElement;
			delete this._rowIdToObject[rowElement.id];
			if (!preserveDom) {
				put(rowElement, '!');
			}
		},

		row: function (target) {
			// summary:
			//		Get the row object by id, object, node, or event
			var id;

			if (target instanceof this._Row) {
				return target; // No-op; already a row
			}

			if (target.target && target.target.nodeType) {
				// Event
				target = target.target;
			}
			if (target.nodeType) {
				// Row element, or child of a row element
				var object;
				do {
					var rowId = target.id;
					if ((object = this._rowIdToObject[rowId])) {
						return new this._Row(rowId.substring(this.id.length + 5), object, target);
					}
					target = target.parentNode;
				}while (target && target !== this.domNode);
				return;
			}

			if (typeof target === 'object') {
				// Assume target represents a collection item
				id = this.collection.getIdentity(target);
			}
			else {
				// Assume target is a row ID
				id = target;
				target = this._rowIdToObject[this.id + '-row-' + id];
			}
			return new this._Row(id, target, byId(this.id + '-row-' + id));
		},
		cell: function (target) {
			// this doesn't do much in a plain list
			return {
				row: this.row(target)
			};
		},

		_move: function (item, steps, targetClass, visible) {
			var nextSibling, current, element;
			// Start at the element indicated by the provided row or cell object.
			element = current = item.element;
			steps = steps || 1;

			do {
				// Outer loop: move in the appropriate direction.
				if ((nextSibling = current[steps < 0 ? 'previousSibling' : 'nextSibling'])) {
					do {
						// Inner loop: advance, and dig into children if applicable.
						current = nextSibling;
						if (current && (current.className + ' ').indexOf(targetClass + ' ') > -1) {
							// Element with the appropriate class name; count step, stop digging.
							element = current;
							steps += steps < 0 ? 1 : -1;
							break;
						}
						// If the next sibling isn't a match, drill down to search, unless
						// visible is true and children are hidden.
					} while ((nextSibling = (!visible || !current.hidden) &&
						current[steps < 0 ? 'lastChild' : 'firstChild']));
				}
				else {
					current = current.parentNode;
					if (!current || current === this.bodyNode || current === this.headerNode) {
						// Break out if we step out of the navigation area entirely.
						break;
					}
				}
			}while (steps);
			// Return the final element we arrived at, which might still be the
			// starting element if we couldn't navigate further in that direction.
			return element;
		},

		up: function (row, steps, visible) {
			// summary:
			//		Returns the row that is the given number of steps (1 by default)
			//		above the row represented by the given object.
			// row:
			//		The row to navigate upward from.
			// steps:
			//		Number of steps to navigate up from the given row; default is 1.
			// visible:
			//		If true, rows that are currently hidden (i.e. children of
			//		collapsed tree rows) will not be counted in the traversal.
			// returns:
			//		A row object representing the appropriate row.  If the top of the
			//		list is reached before the given number of steps, the first row will
			//		be returned.
			if (!row.element) {
				row = this.row(row);
			}
			return this.row(this._move(row, -(steps || 1), 'dgrid-row', visible));
		},
		down: function (row, steps, visible) {
			// summary:
			//		Returns the row that is the given number of steps (1 by default)
			//		below the row represented by the given object.
			// row:
			//		The row to navigate downward from.
			// steps:
			//		Number of steps to navigate down from the given row; default is 1.
			// visible:
			//		If true, rows that are currently hidden (i.e. children of
			//		collapsed tree rows) will not be counted in the traversal.
			// returns:
			//		A row object representing the appropriate row.  If the bottom of the
			//		list is reached before the given number of steps, the last row will
			//		be returned.
			if (!row.element) {
				row = this.row(row);
			}
			return this.row(this._move(row, steps || 1, 'dgrid-row', visible));
		},

		scrollTo: function (options) {
			if (typeof options.x !== 'undefined') {
				this.bodyNode.scrollLeft = options.x;
			}
			if (typeof options.y !== 'undefined') {
				this.bodyNode.scrollTop = options.y;
			}
		},

		getScrollPosition: function () {
			return {
				x: this.bodyNode.scrollLeft,
				y: this.bodyNode.scrollTop
			};
		},

		get: function (/*String*/ name /*, ... */) {
			// summary:
			//		Get a property on a List instance.
			//	name:
			//		The property to get.
			//	returns:
			//		The property value on this List instance.
			// description:
			//		Get a named property on a List object. The property may
			//		potentially be retrieved via a getter method in subclasses. In the base class
			//		this just retrieves the object's property.

			var fn = '_get' + name.charAt(0).toUpperCase() + name.slice(1);

			if (typeof this[fn] === 'function') {
				return this[fn].apply(this, [].slice.call(arguments, 1));
			}

			// Alert users that try to use Dijit-style getter/setters so they don’t get confused
			// if they try to use them and it does not work
			if (! 1  && typeof this[fn + 'Attr'] === 'function') {
				console.warn('dgrid: Use ' + fn + ' instead of ' + fn + 'Attr for getting ' + name);
			}

			return this[name];
		},

		set: function (/*String*/ name, /*Object*/ value /*, ... */) {
			//	summary:
			//		Set a property on a List instance
			//	name:
			//		The property to set.
			//	value:
			//		The value to set in the property.
			//	returns:
			//		The function returns this List instance.
			//	description:
			//		Sets named properties on a List object.
			//		A programmatic setter may be defined in subclasses.
			//
			//		set() may also be called with a hash of name/value pairs, ex:
			//	|	myObj.set({
			//	|		foo: "Howdy",
			//	|		bar: 3
			//	|	})
			//		This is equivalent to calling set(foo, "Howdy") and set(bar, 3)

			if (typeof name === 'object') {
				for (var k in name) {
					this.set(k, name[k]);
				}
			}
			else {
				var fn = '_set' + name.charAt(0).toUpperCase() + name.slice(1);

				if (typeof this[fn] === 'function') {
					this[fn].apply(this, [].slice.call(arguments, 1));
				}
				else {
					// Alert users that try to use Dijit-style getter/setters so they don’t get confused
					// if they try to use them and it does not work
					if (! 1  && typeof this[fn + 'Attr'] === 'function') {
						console.warn('dgrid: Use ' + fn + ' instead of ' + fn + 'Attr for setting ' + name);
					}

					this[name] = value;
				}
			}

			return this;
		},

		// Accept both class and className programmatically to set domNode class.
		_getClass: getClass,
		_setClass: setClass,
		_getClassName: getClass,
		_setClassName: setClass,

		_setSort: function (property, descending) {
			// summary:
			//		Sort the content
			// property: String|Array
			//		String specifying field to sort by, or actual array of objects
			//		with property and descending properties
			// descending: boolean
			//		In the case where property is a string, this argument
			//		specifies whether to sort ascending (false) or descending (true)

			this.sort = typeof property !== 'string' ? property :
				[{property: property, descending: descending}];

			this._applySort();
		},

		_applySort: function () {
			// summary:
			//		Applies the current sort
			// description:
			//		This is an extension point to allow specializations to apply the sort differently

			this.refresh();

			if (this._lastCollection) {
				var sort = this.sort;
				if (sort && sort.length > 0) {
					var property = sort[0].property,
						descending = !!sort[0].descending;
					this._lastCollection.sort(function (a, b) {
						var aVal = a[property], bVal = b[property];
						// fall back undefined values to "" for more consistent behavior
						if (aVal === undefined) {
							aVal = '';
						}
						if (bVal === undefined) {
							bVal = '';
						}
						return aVal === bVal ? 0 : (aVal > bVal !== descending ? 1 : -1);
					});
				}
				this.renderArray(this._lastCollection);
			}
		},

		_setShowHeader: function (show) {
			// this is in List rather than just in Grid, primarily for two reasons:
			// (1) just in case someone *does* want to show a header in a List
			// (2) helps address IE < 8 header display issue in List

			var headerNode = this.headerNode;

			this.showHeader = show;

			// add/remove class which has styles for "hiding" header
			put(headerNode, (show ? '!' : '.') + 'dgrid-header-hidden');

			this.renderHeader();
			this.resize(); // resize to account for (dis)appearance of header

			if (show) {
				// Update scroll position of header to make sure it's in sync.
				headerNode.scrollLeft = this.getScrollPosition().x;
			}
		},

		_setShowFooter: function (show) {
			this.showFooter = show;

			// add/remove class which has styles for hiding footer
			put(this.footerNode, (show ? '!' : '.') + 'dgrid-footer-hidden');

			this.resize(); // to account for (dis)appearance of footer
		}
	});
});

},
'dgrid/util/misc':function(){
define([
	'dojo/has',
	'put-selector/put'
], function (has, put) {
	// summary:
	//		This module defines miscellaneous utility methods for purposes of
	//		adding styles, and throttling/debouncing function calls.

	has.add('dom-contains', function (global, doc, element) {
		return !!element.contains; // not supported by FF < 9
	});

	// establish an extra stylesheet which addCssRule calls will use,
	// plus an array to track actual indices in stylesheet for removal
	var extraRules = [],
		extraSheet,
		removeMethod,
		rulesProperty,
		invalidCssChars = /([^A-Za-z0-9_\u00A0-\uFFFF-])/g;

	function removeRule(index) {
		// Function called by the remove method on objects returned by addCssRule.
		var realIndex = extraRules[index],
			i, l;
		if (realIndex === undefined) {
			return; // already removed
		}

		// remove rule indicated in internal array at index
		extraSheet[removeMethod](realIndex);

		// Clear internal array item representing rule that was just deleted.
		// NOTE: we do NOT splice, since the point of this array is specifically
		// to negotiate the splicing that occurs in the stylesheet itself!
		extraRules[index] = undefined;

		// Then update array items as necessary to downshift remaining rule indices.
		// Can start at index + 1, since array is sparse but strictly increasing.
		for (i = index + 1, l = extraRules.length; i < l; i++) {
			if (extraRules[i] > realIndex) {
				extraRules[i]--;
			}
		}
	}

	var util = {
		// Throttle/debounce functions

		defaultDelay: 15,
		throttle: function (cb, context, delay) {
			// summary:
			//		Returns a function which calls the given callback at most once per
			//		delay milliseconds.  (Inspired by plugd)
			var ran = false;
			delay = delay || util.defaultDelay;
			return function () {
				if (ran) {
					return;
				}
				ran = true;
				cb.apply(context, arguments);
				setTimeout(function () {
					ran = false;
				}, delay);
			};
		},
		throttleDelayed: function (cb, context, delay) {
			// summary:
			//		Like throttle, except that the callback runs after the delay,
			//		rather than before it.
			var ran = false;
			delay = delay || util.defaultDelay;
			return function () {
				if (ran) {
					return;
				}
				ran = true;
				var a = arguments;
				setTimeout(function () {
					ran = false;
					cb.apply(context, a);
				}, delay);
			};
		},
		debounce: function (cb, context, delay) {
			// summary:
			//		Returns a function which calls the given callback only after a
			//		certain time has passed without successive calls.  (Inspired by plugd)
			var timer;
			delay = delay || util.defaultDelay;
			return function () {
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
				var a = arguments;
				timer = setTimeout(function () {
					cb.apply(context, a);
				}, delay);
			};
		},

		// Iterative functions

		each: function (arrayOrObject, callback, context) {
			// summary:
			//		Given an array or object, iterates through its keys.
			//		Does not use hasOwnProperty (since even Dojo does not
			//		consistently use it), but will iterate using a for or for-in
			//		loop as appropriate.

			var i, len;

			if (!arrayOrObject) {
				return;
			}

			if (typeof arrayOrObject.length === 'number') {
				for (i = 0, len = arrayOrObject.length; i < len; i++) {
					callback.call(context, arrayOrObject[i], i, arrayOrObject);
				}
			}
			else {
				for (i in arrayOrObject) {
					callback.call(context, arrayOrObject[i], i, arrayOrObject);
				}
			}
		},

		// DOM-related functions

		contains: function (parent, node) {
			// summary:
			//		Checks to see if an element is contained in another element.

			if (has('dom-contains')) {
				return parent.contains(node);
			}
			else {
				return parent.compareDocumentPosition(node) & /* DOCUMENT_POSITION_CONTAINS */ 8;
			}
		},

		// CSS-related functions

		addCssRule: function (selector, css) {
			// summary:
			//		Dynamically adds a style rule to the document.  Returns an object
			//		with a remove method which can be called to later remove the rule.

			if (!extraSheet) {
				// First time, create an extra stylesheet for adding rules
				extraSheet = put(document.getElementsByTagName('head')[0], 'style');
				// Keep reference to actual StyleSheet object (`styleSheet` for IE < 9)
				extraSheet = extraSheet.sheet || extraSheet.styleSheet;
				// Store name of method used to remove rules (`removeRule` for IE < 9)
				removeMethod = extraSheet.deleteRule ? 'deleteRule' : 'removeRule';
				// Store name of property used to access rules (`rules` for IE < 9)
				rulesProperty = extraSheet.cssRules ? 'cssRules' : 'rules';
			}

			var index = extraRules.length;
			extraRules[index] = (extraSheet.cssRules || extraSheet.rules).length;
			extraSheet.addRule ?
				extraSheet.addRule(selector, css) :
				extraSheet.insertRule(selector + '{' + css + '}', extraRules[index]);

			return {
				get: function (prop) {
					return extraSheet[rulesProperty][extraRules[index]].style[prop];
				},
				set: function (prop, value) {
					if (typeof extraRules[index] !== 'undefined') {
						extraSheet[rulesProperty][extraRules[index]].style[prop] = value;
					}
				},
				remove: function () {
					removeRule(index);
				}
			};
		},

		escapeCssIdentifier: function (id, replace) {
			// summary:
			//		Escapes normally-invalid characters in a CSS identifier (such as . or :);
			//		see http://www.w3.org/TR/CSS2/syndata.html#value-def-identifier
			// id: String
			//		CSS identifier (e.g. tag name, class, or id) to be escaped
			// replace: String?
			//		If specified, indicates that invalid characters should be
			//		replaced by the given string rather than being escaped

			return typeof id === 'string' ? id.replace(invalidCssChars, replace || '\\$1') : id;
		}
	};
	return util;
});
},
'put-selector/put':function(){
(function(define){
var forDocument, fragmentFasterHeuristic = /[-+,> ]/; // if it has any of these combinators, it is probably going to be faster with a document fragment 
define([], forDocument = function(doc, newFragmentFasterHeuristic){
"use strict";
	// module:
	//		put-selector/put
	// summary:
	//		This module defines a fast lightweight function for updating and creating new elements
	//		terse, CSS selector-based syntax. The single function from this module creates
	// 		new DOM elements and updates existing elements. See README.md for more information.
	//	examples:
	//		To create a simple div with a class name of "foo":
	//		|	put("div.foo");
	fragmentFasterHeuristic = newFragmentFasterHeuristic || fragmentFasterHeuristic;
	var selectorParse = /(?:\s*([-+ ,<>]))?\s*(\.|!\.?|#)?([-\w\u00A0-\uFFFF%$|]+)?(?:\[([^\]=]+)=?['"]?([^\]'"]*)['"]?\])?/g,
		undefined, namespaceIndex, namespaces = false,
		doc = doc || document,
		ieCreateElement = typeof doc.createElement == "object"; // telltale sign of the old IE behavior with createElement that does not support later addition of name 
	function insertTextNode(element, text){
		element.appendChild(doc.createTextNode(text));
	}
	function put(topReferenceElement){
		var fragment, lastSelectorArg, nextSibling, referenceElement, current,
			args = arguments,
			returnValue = args[0]; // use the first argument as the default return value in case only an element is passed in
		function insertLastElement(){
			// we perform insertBefore actions after the element is fully created to work properly with 
			// <input> tags in older versions of IE that require type attributes
			//	to be set before it is attached to a parent.
			// We also handle top level as a document fragment actions in a complex creation 
			// are done on a detached DOM which is much faster
			// Also if there is a parse error, we generally error out before doing any DOM operations (more atomic) 
			if(current && referenceElement && current != referenceElement){
				(referenceElement == topReferenceElement &&
					// top level, may use fragment for faster access 
					(fragment || 
						// fragment doesn't exist yet, check to see if we really want to create it 
						(fragment = fragmentFasterHeuristic.test(argument) && doc.createDocumentFragment()))
							// any of the above fails just use the referenceElement  
							 ? fragment : referenceElement).
								insertBefore(current, nextSibling || null); // do the actual insertion
			}
		}
		for(var i = 0; i < args.length; i++){
			var argument = args[i];
			if(typeof argument == "object"){
				lastSelectorArg = false;
				if(argument instanceof Array){
					// an array
					current = doc.createDocumentFragment();
					for(var key = 0; key < argument.length; key++){
						current.appendChild(put(argument[key]));
					}
					argument = current;
				}
				if(argument.nodeType){
					current = argument;
					insertLastElement();
					referenceElement = argument;
					nextSibling = 0;
				}else{
					// an object hash
					for(var key in argument){
						current[key] = argument[key];
					}				
				}
			}else if(lastSelectorArg){
				// a text node should be created
				// take a scalar value, use createTextNode so it is properly escaped
				// createTextNode is generally several times faster than doing an escaped innerHTML insertion: http://jsperf.com/createtextnode-vs-innerhtml/2
				lastSelectorArg = false;
				insertTextNode(current, argument);
			}else{
				if(i < 1){
					// if we are starting with a selector, there is no top element
					topReferenceElement = null;
				}
				lastSelectorArg = true;
				var leftoverCharacters = argument.replace(selectorParse, function(t, combinator, prefix, value, attrName, attrValue){
					if(combinator){
						// insert the last current object
						insertLastElement();
						if(combinator == '-' || combinator == '+'){
							// + or - combinator, 
							// TODO: add support for >- as a means of indicating before the first child?
							referenceElement = (nextSibling = (current || referenceElement)).parentNode;
							current = null;
							if(combinator == "+"){
								nextSibling = nextSibling.nextSibling;
							}// else a - operator, again not in CSS, but obvious in it's meaning (create next element before the current/referenceElement)
						}else{
							if(combinator == "<"){
								// parent combinator (not really in CSS, but theorized, and obvious in it's meaning)
								referenceElement = current = (current || referenceElement).parentNode;
							}else{
								if(combinator == ","){
									// comma combinator, start a new selector
									referenceElement = topReferenceElement;
								}else if(current){
									// else descendent or child selector (doesn't matter, treated the same),
									referenceElement = current;
								}
								current = null;
							}
							nextSibling = 0;
						}
						if(current){
							referenceElement = current;
						}
					}
					var tag = !prefix && value;
					if(tag || (!current && (prefix || attrName))){
						if(tag == "$"){
							// this is a variable to be replaced with a text node
							insertTextNode(referenceElement, args[++i]);
						}else{
							// Need to create an element
							tag = tag || put.defaultTag;
							var ieInputName = ieCreateElement && args[i +1] && args[i +1].name;
							if(ieInputName){
								// in IE, we have to use the crazy non-standard createElement to create input's that have a name 
								tag = '<' + tag + ' name="' + ieInputName + '">';
							}
							// we swtich between creation methods based on namespace usage
							current = namespaces && ~(namespaceIndex = tag.indexOf('|')) ?
								doc.createElementNS(namespaces[tag.slice(0, namespaceIndex)], tag.slice(namespaceIndex + 1)) : 
								doc.createElement(tag);
						}
					}
					if(prefix){
						if(value == "$"){
							value = args[++i];
						}
						if(prefix == "#"){
							// #id was specified
							current.id = value;
						}else{
							// we are in the className addition and removal branch
							var currentClassName = current.className;
							// remove the className (needed for addition or removal)
							// see http://jsperf.com/remove-class-name-algorithm/2 for some tests on this
							var removed = currentClassName && (" " + currentClassName + " ").replace(" " + value + " ", " ");
							if(prefix == "."){
								// addition, add the className
								current.className = currentClassName ? (removed + value).substring(1) : value;
							}else{
								// else a '!' class removal
								if(argument == "!"){
									var parentNode;
									// special signal to delete this element
									if(ieCreateElement){
										// use the ol' innerHTML trick to get IE to do some cleanup
										put("div", current, '<').innerHTML = "";
									}else if(parentNode = current.parentNode){ // intentional assigment
										// use a faster, and more correct (for namespaced elements) removal (http://jsperf.com/removechild-innerhtml)
										parentNode.removeChild(current);
									}
								}else{
									// we already have removed the class, just need to trim
									removed = removed.substring(1, removed.length - 1);
									// only assign if it changed, this can save a lot of time
									if(removed != currentClassName){
										current.className = removed;
									}
								}
							}
							// CSS class removal
						}
					}
					if(attrName){
						if(attrValue == "$"){
							attrValue = args[++i];
						}
						// [name=value]
						if(attrName == "style"){
							// handle the special case of setAttribute not working in old IE
							current.style.cssText = attrValue;
						}else{
							var method = attrName.charAt(0) == "!" ? (attrName = attrName.substring(1)) && 'removeAttribute' : 'setAttribute';
							attrValue = attrValue === '' ? attrName : attrValue;
							// determine if we need to use a namespace
							namespaces && ~(namespaceIndex = attrName.indexOf('|')) ?
								current[method + "NS"](namespaces[attrName.slice(0, namespaceIndex)], attrName.slice(namespaceIndex + 1), attrValue) :
								current[method](attrName, attrValue);
						}
					}
					return '';
				});
				if(leftoverCharacters){
					throw new SyntaxError("Unexpected char " + leftoverCharacters + " in " + argument);
				}
				insertLastElement();
				referenceElement = returnValue = current || referenceElement;
			}
		}
		if(topReferenceElement && fragment){
			// we now insert the top level elements for the fragment if it exists
			topReferenceElement.appendChild(fragment);
		}
		return returnValue;
	}
	put.addNamespace = function(name, uri){
		if(doc.createElementNS){
			(namespaces || (namespaces = {}))[name] = uri;
		}else{
			// for old IE
			doc.namespaces.add(name, uri);
		}
	};
	put.defaultTag = "div";
	put.forDocument = forDocument;
	return put;
});
})(function(id, deps, factory){
	factory = factory || deps;
	if(typeof define === "function"){
		// AMD loader
		define([], function(){
			return factory();
		});
	}else if(typeof window == "undefined"){
		// server side JavaScript, probably (hopefully) NodeJS
		require("./node-html")(module, factory);
	}else{
		// plain script in a browser
		put = factory();
	}
});

},
'xstyle/has-class':function(){
define(["dojo/has"], function(has){
	var tested = {};
	return function(){
		var test, args = arguments;
		for(var i = 0; i < args.length; i++){
			var test = args[i];
			if(!tested[test]){
				tested[test] = true;
				var parts = test.match(/^(no-)?(.+?)((-[\d\.]+)(-[\d\.]+)?)?$/), // parse the class name
					hasResult = has(parts[2]), // the actual has test
					lower = -parts[4]; // lower bound if it is in the form of test-4 or test-4-6 (would be 4)
				if((lower > 0 ? lower <= hasResult && (-parts[5] || lower) >= hasResult :  // if it has a range boundary, compare to see if we are in it
						!!hasResult) == !parts[1]){ // parts[1] is the no- prefix that can negate the result
					document.documentElement.className += ' has-' + test;
				}
			}
		}
	}
});
},
'xstyle/css':function(){
define(["require"], function(moduleRequire){
"use strict";
/*
 * AMD css! plugin
 * This plugin will load and wait for css files. This allows JavaScript resources to 
 * fully there dependencies on stylesheets. This can also be used when
 * loading css files as part of a layer or as a way to apply a run-time theme. This
 * module checks to see if the CSS is already loaded before incurring the cost
 * of loading the full CSS loader codebase
 */
 	function testElementStyle(tag, id, property){
 		// test an element's style
		var docElement = document.documentElement;
		var testDiv = docElement.insertBefore(document.createElement(tag), docElement.firstChild);
		testDiv.id = id;
		var styleValue = (testDiv.currentStyle || getComputedStyle(testDiv, null))[property];
		docElement.removeChild(testDiv);
 		return styleValue;
 	} 
 	return {
		load: function(resourceDef, require, callback, config) {
			var url = require.toUrl(resourceDef);
			var options;
			if(url.match(/!$/)){
				// a final ! can be used to indicate not to wait for the stylesheet to load
				options = {
					wait: false
				};
				url = url.slice(0, -1);
			}
			var cachedCss = require.cache && require.cache['url:' + url];
			if(cachedCss){
				// we have CSS cached inline in the build
				if(cachedCss.xCss){
					var parser = cachedCss.parser;
					var xCss =cachedCss.xCss;
					cachedCss = cachedCss.cssText;
				}
				moduleRequire(['./core/load-css'],function(load){
					checkForParser(load.insertCss(cachedCss));
				});
				if(xCss){
					//require([parsed], callback);
				}
				return;
			}
			function checkForParser(styleSheetElement){
				var parser = testElementStyle('x-parse', null, 'content');
				var sheet = styleSheetElement && 
					(styleSheetElement.sheet || styleSheetElement.styleSheet);
				if(parser && parser != 'none'){
					// TODO: wait for parser to load
					require([eval(parser)], function(parser){
						if(styleSheetElement){
							parser.process(styleSheetElement, callback);
						}else{
							parser.processAll();
							callback(sheet);
						}
					});
				}else{
					callback(sheet);
				}
			}
			
			// if there is an id test available, see if the referenced rule is already loaded,
			// and if so we can completely avoid any dynamic CSS loading. If it is
			// not present, we need to use the dynamic CSS loader.
			var displayStyle = testElementStyle('div', resourceDef.replace(/\//g,'-').replace(/\..*/,'') + "-loaded", 'display');
			if(displayStyle == "none"){
				return checkForParser();
			}
			// use dynamic loader
			moduleRequire(["./core/load-css"], function(load){
				load(url, checkForParser, options);
			});
		}
	};
});

},
'xstyle/core/load-css':function(){
define([], function(){
	'use strict';
	// this module is responsible for doing the loading/insertion
	// of stylesheets to get CSS loaded.

	var cache = typeof _css_cache == 'undefined' ? {} : _css_cache;
	var doc = document;

	function has(){
		return !doc.createStyleSheet;
	}
	var head = doc.head;
	function insertCss(css){
		if(has("dom-create-style-element")){
			// we can use standard <style> element creation
			styleSheet = doc.createElement("style");
			styleSheet.setAttribute("type", "text/css");
			styleSheet.appendChild(doc.createTextNode(css));
			head.insertBefore(styleSheet, head.firstChild);
			return styleSheet;
		}
		else{
			// IE's stylesheet insertion
			var styleSheet = doc.createStyleSheet();
			styleSheet.cssText = css;
			return styleSheet.owningElement;
		}
	}

	function load(resourceDef, callback, options){
		var cached = cache[resourceDef];
		if(cached){
			// if it is cached (from a build), we directly insert
			link = insertCss(cached);
			return callback(link);
		}
		// create a link element to load the stylesheet
		var link = doc.createElement('link');
		link.type = 'text/css';
		link.rel = 'stylesheet';
		link.href = resourceDef;
		var wait = !options || options.wait !== false;
		// old webkit's would claim to have onload, but didn't really support it
		var webkitVersion = navigator.userAgent.match(/AppleWebKit\/(\d+\.?\d*)/);
		webkitVersion = webkitVersion && +webkitVersion[1];
		if(link.onload === null && !(webkitVersion < 536)){
			// most browsers support this onload function now
			link.onload = function(){
				// cleanup
				link.onload = null;
				link.onerror = null;
				wait && callback(link);
			};
			// always add the error handler, so we can notify of any errors
			link.onerror = function(){
				// there isn't really any recourse in AMD for errors, so
				// we just output the error and continue on
				console.error('Error loading stylesheet ' + resourceDef);
				wait && callback(link);
			};
		}else if(wait){
			var interval = setInterval(function(){
				if(link.style){
					// loaded
					clearInterval(interval);
					callback(link);
				}
			}, 15);
		}
		// add it to the head to trigger loading
		(head || doc.getElementsByTagName('head')[0]).appendChild(link);
		if(!wait){
			// don't wait for the stylesheet to load, proceed
			callback(link);
		}
	}
	load.insertCss = insertCss;
	return load;
});

},
'dgrid/Keyboard':function(){
define([
	'dojo/_base/declare',
	'dojo/aspect',
	'dojo/on',
	'dojo/_base/lang',
	'dojo/has',
	'put-selector/put',
	'./util/misc',
	'dojo/_base/sniff'
], function (declare, aspect, on, lang, has, put, miscUtil) {

	var delegatingInputTypes = {
			checkbox: 1,
			radio: 1,
			button: 1
		},
		hasGridCellClass = /\bdgrid-cell\b/,
		hasGridRowClass = /\bdgrid-row\b/;

	var Keyboard = declare(null, {
		// summary:
		//		Adds keyboard navigation capability to a list or grid.

		// pageSkip: Number
		//		Number of rows to jump by when page up or page down is pressed.
		pageSkip: 10,

		tabIndex: 0,

		// keyMap: Object
		//		Hash which maps key codes to functions to be executed (in the context
		//		of the instance) for key events within the grid's body.
		keyMap: null,

		// headerKeyMap: Object
		//		Hash which maps key codes to functions to be executed (in the context
		//		of the instance) for key events within the grid's header row.
		headerKeyMap: null,

		postMixInProperties: function () {
			this.inherited(arguments);

			if (!this.keyMap) {
				this.keyMap = lang.mixin({}, Keyboard.defaultKeyMap);
			}
			if (!this.headerKeyMap) {
				this.headerKeyMap = lang.mixin({}, Keyboard.defaultHeaderKeyMap);
			}
		},

		postCreate: function () {
			this.inherited(arguments);
			var grid = this;

			function handledEvent(event) {
				// Text boxes and other inputs that can use direction keys should be ignored
				// and not affect cell/row navigation
				var target = event.target;
				return target.type && (!delegatingInputTypes[target.type] || event.keyCode === 32);
			}

			function enableNavigation(areaNode) {
				var cellNavigation = grid.cellNavigation,
					isFocusableClass = cellNavigation ? hasGridCellClass : hasGridRowClass,
					isHeader = areaNode === grid.headerNode,
					initialNode = areaNode;

				function initHeader() {
					if (grid._focusedHeaderNode) {
						// Remove the tab index for the node that previously had it.
						grid._focusedHeaderNode.tabIndex = -1;
					}
					if (grid.showHeader) {
						if (cellNavigation) {
							// Get the focused element. Ensure that the focused element
							// is actually a grid cell, not a column-set-cell or some
							// other cell that should not be focused
							var elements = grid.headerNode.getElementsByTagName('th');
							for (var i = 0, element; (element = elements[i]); ++i) {
								if (isFocusableClass.test(element.className)) {
									grid._focusedHeaderNode = initialNode = element;
									break;
								}
							}
						}
						else {
							grid._focusedHeaderNode = initialNode = grid.headerNode;
						}

						// Set the tab index only if the header is visible.
						if (initialNode) {
							initialNode.tabIndex = grid.tabIndex;
						}
					}
				}

				if (isHeader) {
					// Initialize header now (since it's already been rendered),
					// and aspect after future renderHeader calls to reset focus.
					initHeader();
					aspect.after(grid, 'renderHeader', initHeader, true);
				}
				else {
					aspect.after(grid, 'renderArray', function (rows) {
						// summary:
						//		Ensures the first element of a grid is always keyboard selectable after data has been
						//		retrieved if there is not already a valid focused element.

						var focusedNode = grid._focusedNode || initialNode;

						// do not update the focused element if we already have a valid one
						if (isFocusableClass.test(focusedNode.className) && miscUtil.contains(areaNode, focusedNode)) {
							return rows;
						}

						// ensure that the focused element is actually a grid cell, not a
						// dgrid-preload or dgrid-content element, which should not be focusable,
						// even when data is loaded asynchronously
						var elements = areaNode.getElementsByTagName('*');
						for (var i = 0, element; (element = elements[i]); ++i) {
							if (isFocusableClass.test(element.className)) {
								focusedNode = grid._focusedNode = element;
								break;
							}
						}

						focusedNode.tabIndex = grid.tabIndex;
						return rows;
					});
				}

				grid._listeners.push(on(areaNode, 'mousedown', function (event) {
					if (!handledEvent(event)) {
						grid._focusOnNode(event.target, isHeader, event);
					}
				}));

				grid._listeners.push(on(areaNode, 'keydown', function (event) {
					// For now, don't squash browser-specific functionalities by letting
					// ALT and META function as they would natively
					if (event.metaKey || event.altKey) {
						return;
					}

					var handler = grid[isHeader ? 'headerKeyMap' : 'keyMap'][event.keyCode];

					// Text boxes and other inputs that can use direction keys should be ignored
					// and not affect cell/row navigation
					if (handler && !handledEvent(event)) {
						handler.call(grid, event);
					}
				}));
			}

			if (this.tabableHeader) {
				enableNavigation(this.headerNode);
				on(this.headerNode, 'dgrid-cellfocusin', function () {
					grid.scrollTo({ x: this.scrollLeft });
				});
			}
			enableNavigation(this.contentNode);
		},

		removeRow: function (rowElement) {
			if (!this._focusedNode) {
				// Nothing special to do if we have no record of anything focused
				return this.inherited(arguments);
			}

			var self = this,
				isActive = document.activeElement === this._focusedNode,
				focusedTarget = this[this.cellNavigation ? 'cell' : 'row'](this._focusedNode),
				focusedRow = focusedTarget.row || focusedTarget,
				sibling;
			rowElement = rowElement.element || rowElement;

			// If removed row previously had focus, temporarily store information
			// to be handled in an immediately-following insertRow call, or next turn
			if (rowElement === focusedRow.element) {
				sibling = this.down(focusedRow, true);

				// Check whether down call returned the same row, or failed to return
				// any (e.g. during a partial unrendering)
				if (!sibling || sibling.element === rowElement) {
					sibling = this.up(focusedRow, true);
				}

				this._removedFocus = {
					active: isActive,
					rowId: focusedRow.id,
					columnId: focusedTarget.column && focusedTarget.column.id,
					siblingId: !sibling || sibling.element === rowElement ? undefined : sibling.id
				};

				// Call _restoreFocus on next turn, to restore focus to sibling
				// if no replacement row was immediately inserted.
				// Pass original row's id in case it was re-inserted in a renderArray
				// call (and thus was found, but couldn't be focused immediately)
				setTimeout(function () {
					if (self._removedFocus) {
						self._restoreFocus(focusedRow.id);
					}
				}, 0);

				// Clear _focusedNode until _restoreFocus is called, to avoid
				// needlessly re-running this logic
				this._focusedNode = null;
			}

			this.inherited(arguments);
		},

		insertRow: function () {
			var rowElement = this.inherited(arguments);
			if (this._removedFocus && !this._removedFocus.wait) {
				this._restoreFocus(rowElement);
			}
			return rowElement;
		},

		_restoreFocus: function (row) {
			// summary:
			//		Restores focus to the newly inserted row if it matches the
			//		previously removed row, or to the nearest sibling otherwise.

			var focusInfo = this._removedFocus,
				newTarget,
				cell;

			row = row && this.row(row);
			newTarget = row && row.element && row.id === focusInfo.rowId ? row :
				typeof focusInfo.siblingId !== 'undefined' && this.row(focusInfo.siblingId);

			if (newTarget && newTarget.element) {
				if (!newTarget.element.parentNode.parentNode) {
					// This was called from renderArray, so the row hasn't
					// actually been placed in the DOM yet; handle it on the next
					// turn (called from removeRow).
					focusInfo.wait = true;
					return;
				}
				// Should focus be on a cell?
				if (typeof focusInfo.columnId !== 'undefined') {
					cell = this.cell(newTarget, focusInfo.columnId);
					if (cell && cell.element) {
						newTarget = cell;
					}
				}
				if (focusInfo.active && newTarget.element.offsetHeight !== 0) {
					// Row/cell was previously focused and is visible, so focus the new one immediately
					this._focusOnNode(newTarget, false, null);
				}
				else {
					// Row/cell was not focused or is not visible, but we still need to
					// update _focusedNode and the element's tabIndex/class
					put(newTarget.element, '.dgrid-focus');
					newTarget.element.tabIndex = this.tabIndex;
					this._focusedNode = newTarget.element;
				}
			}

			delete this._removedFocus;
		},

		addKeyHandler: function (key, callback, isHeader) {
			// summary:
			//		Adds a handler to the keyMap on the instance.
			//		Supports binding additional handlers to already-mapped keys.
			// key: Number
			//		Key code representing the key to be handled.
			// callback: Function
			//		Callback to be executed (in instance context) when the key is pressed.
			// isHeader: Boolean
			//		Whether the handler is to be added for the grid body (false, default)
			//		or the header (true).

			// Aspects may be about 10% slower than using an array-based appraoch,
			// but there is significantly less code involved (here and above).
			return aspect.after( // Handle
				this[isHeader ? 'headerKeyMap' : 'keyMap'], key, callback, true);
		},

		_focusOnNode: function (element, isHeader, event) {
			var focusedNodeProperty = '_focused' + (isHeader ? 'Header' : '') + 'Node',
				focusedNode = this[focusedNodeProperty],
				cellOrRowType = this.cellNavigation ? 'cell' : 'row',
				cell = this[cellOrRowType](element),
				inputs,
				input,
				numInputs,
				inputFocused,
				i;

			element = cell && cell.element;
			if (!element) {
				return;
			}

			if (this.cellNavigation) {
				inputs = element.getElementsByTagName('input');
				for (i = 0, numInputs = inputs.length; i < numInputs; i++) {
					input = inputs[i];
					if ((input.tabIndex !== -1 || '_dgridLastValue' in input) && !input.disabled) {
						input.focus();
						inputFocused = true;
						break;
					}
				}
			}

			// Set up event information for dgrid-cellfocusout/in events.
			// Note that these events are not fired for _restoreFocus.
			if (event !== null) {
				event = lang.mixin({ grid: this }, event);
				if (event.type) {
					event.parentType = event.type;
				}
				if (!event.bubbles) {
					// IE doesn't always have a bubbles property already true.
					// Opera throws if you try to set it to true if it is already true.
					event.bubbles = true;
				}
			}

			if (focusedNode) {
				// Clean up previously-focused element
				// Remove the class name and the tabIndex attribute
				put(focusedNode, '!dgrid-focus[!tabIndex]');

				// Expose object representing focused cell or row losing focus, via
				// event.cell or event.row; which is set depends on cellNavigation.
				if (event) {
					event[cellOrRowType] = this[cellOrRowType](focusedNode);
					on.emit(focusedNode, 'dgrid-cellfocusout', event);
				}
			}
			focusedNode = this[focusedNodeProperty] = element;

			if (event) {
				// Expose object representing focused cell or row gaining focus, via
				// event.cell or event.row; which is set depends on cellNavigation.
				// Note that yes, the same event object is being reused; on.emit
				// performs a shallow copy of properties into a new event object.
				event[cellOrRowType] = cell;
			}

			var isFocusableClass = this.cellNavigation ? hasGridCellClass : hasGridRowClass;
			if (!inputFocused && isFocusableClass.test(element.className)) {
				element.tabIndex = this.tabIndex;
				element.focus();
			}
			put(element, '.dgrid-focus');

			if (event) {
				on.emit(focusedNode, 'dgrid-cellfocusin', event);
			}
		},

		focusHeader: function (element) {
			this._focusOnNode(element || this._focusedHeaderNode, true);
		},

		focus: function (element) {
			var node = element || this._focusedNode;
			if (node) {
				this._focusOnNode(node, false);
			}
			else {
				this.contentNode.focus();
			}
		}
	});

	// Common functions used in default keyMap (called in instance context)

	var moveFocusVertical = Keyboard.moveFocusVertical = function (event, steps) {
		var cellNavigation = this.cellNavigation,
			target = this[cellNavigation ? 'cell' : 'row'](event),
			columnId = cellNavigation && target.column.id,
			next = this.down(this._focusedNode, steps, true);

		// Navigate within same column if cell navigation is enabled
		if (cellNavigation) {
			next = this.cell(next, columnId);
		}
		this._focusOnNode(next, false, event);

		event.preventDefault();
	};

	var moveFocusUp = Keyboard.moveFocusUp = function (event) {
		moveFocusVertical.call(this, event, -1);
	};

	var moveFocusDown = Keyboard.moveFocusDown = function (event) {
		moveFocusVertical.call(this, event, 1);
	};

	var moveFocusPageUp = Keyboard.moveFocusPageUp = function (event) {
		moveFocusVertical.call(this, event, -this.pageSkip);
	};

	var moveFocusPageDown = Keyboard.moveFocusPageDown = function (event) {
		moveFocusVertical.call(this, event, this.pageSkip);
	};

	var moveFocusHorizontal = Keyboard.moveFocusHorizontal = function (event, steps) {
		if (!this.cellNavigation) {
			return;
		}
		var isHeader = !this.row(event), // header reports row as undefined
			currentNode = this['_focused' + (isHeader ? 'Header' : '') + 'Node'];

		this._focusOnNode(this.right(currentNode, steps), isHeader, event);
		event.preventDefault();
	};

	var moveFocusLeft = Keyboard.moveFocusLeft = function (event) {
		moveFocusHorizontal.call(this, event, -1);
	};

	var moveFocusRight = Keyboard.moveFocusRight = function (event) {
		moveFocusHorizontal.call(this, event, 1);
	};

	var moveHeaderFocusEnd = Keyboard.moveHeaderFocusEnd = function (event, scrollToBeginning) {
		// Header case is always simple, since all rows/cells are present
		var nodes;
		if (this.cellNavigation) {
			nodes = this.headerNode.getElementsByTagName('th');
			this._focusOnNode(nodes[scrollToBeginning ? 0 : nodes.length - 1], true, event);
		}
		// In row-navigation mode, there's nothing to do - only one row in header

		// Prevent browser from scrolling entire page
		event.preventDefault();
	};

	var moveHeaderFocusHome = Keyboard.moveHeaderFocusHome = function (event) {
		moveHeaderFocusEnd.call(this, event, true);
	};

	var moveFocusEnd = Keyboard.moveFocusEnd = function (event, scrollToTop) {
		// summary:
		//		Handles requests to scroll to the beginning or end of the grid.

		// Assume scrolling to top unless event is specifically for End key
		var cellNavigation = this.cellNavigation,
			contentNode = this.contentNode,
			contentPos = scrollToTop ? 0 : contentNode.scrollHeight,
			scrollPos = contentNode.scrollTop + contentPos,
			endChild = contentNode[scrollToTop ? 'firstChild' : 'lastChild'],
			hasPreload = endChild.className.indexOf('dgrid-preload') > -1,
			endTarget = hasPreload ? endChild[(scrollToTop ? 'next' : 'previous') + 'Sibling'] : endChild,
			endPos = endTarget.offsetTop + (scrollToTop ? 0 : endTarget.offsetHeight),
			handle;

		if (hasPreload) {
			// Find the nearest dgrid-row to the relevant end of the grid
			while (endTarget && endTarget.className.indexOf('dgrid-row') < 0) {
				endTarget = endTarget[(scrollToTop ? 'next' : 'previous') + 'Sibling'];
			}
			// If none is found, there are no rows, and nothing to navigate
			if (!endTarget) {
				return;
			}
		}

		// Grid content may be lazy-loaded, so check if content needs to be
		// loaded first
		if (!hasPreload || endChild.offsetHeight < 1) {
			// End row is loaded; focus the first/last row/cell now
			if (cellNavigation) {
				// Preserve column that was currently focused
				endTarget = this.cell(endTarget, this.cell(event).column.id);
			}
			this._focusOnNode(endTarget, false, event);
		}
		else {
			// In IE < 9, the event member references will become invalid by the time
			// _focusOnNode is called, so make a (shallow) copy up-front
			if (!has('dom-addeventlistener')) {
				event = lang.mixin({}, event);
			}

			// If the topmost/bottommost row rendered doesn't reach the top/bottom of
			// the contentNode, we are using OnDemandList and need to wait for more
			// data to render, then focus the first/last row in the new content.
			handle = aspect.after(this, 'renderArray', function (rows) {
				var target = rows[scrollToTop ? 0 : rows.length - 1];
				if (cellNavigation) {
					// Preserve column that was currently focused
					target = this.cell(target, this.cell(event).column.id);
				}
				this._focusOnNode(target, false, event);
				handle.remove();
				return rows;
			});
		}

		if (scrollPos === endPos) {
			// Grid body is already scrolled to end; prevent browser from scrolling
			// entire page instead
			event.preventDefault();
		}
	};

	var moveFocusHome = Keyboard.moveFocusHome = function (event) {
		moveFocusEnd.call(this, event, true);
	};

	function preventDefault(event) {
		event.preventDefault();
	}

	Keyboard.defaultKeyMap = {
		32: preventDefault, // space
		33: moveFocusPageUp, // page up
		34: moveFocusPageDown, // page down
		35: moveFocusEnd, // end
		36: moveFocusHome, // home
		37: moveFocusLeft, // left
		38: moveFocusUp, // up
		39: moveFocusRight, // right
		40: moveFocusDown // down
	};

	// Header needs fewer default bindings (no vertical), so bind it separately
	Keyboard.defaultHeaderKeyMap = {
		32: preventDefault, // space
		35: moveHeaderFocusEnd, // end
		36: moveHeaderFocusHome, // home
		37: moveFocusLeft, // left
		39: moveFocusRight // right
	};

	return Keyboard;
});
},
'dgrid/Grid':function(){
define([
	'dojo/_base/declare',
	'dojo/_base/kernel',
	'dojo/on',
	'dojo/has',
	'put-selector/put',
	'./List',
	'./util/misc',
	'dojo/_base/sniff'
], function (declare, kernel, listen, has, put, List, miscUtil) {
	function appendIfNode(parent, subNode) {
		if (subNode && subNode.nodeType) {
			parent.appendChild(subNode);
		}
	}

	function replaceInvalidChars(str) {
		// Replaces invalid characters for a CSS identifier with hyphen,
		// as dgrid does for field names / column IDs when adding classes.
		return miscUtil.escapeCssIdentifier(str, '-');
	}

	var Grid = declare(List, {
		columns: null,
		// cellNavigation: Boolean
		//		This indicates that focus is at the cell level. This may be set to false to cause
		//		focus to be at the row level, which is useful if you want only want row-level
		//		navigation.
		cellNavigation: true,
		tabableHeader: true,
		showHeader: true,
		column: function (target) {
			// summary:
			//		Get the column object by node, or event, or a columnId
			if (typeof target !== 'object') {
				return this.columns[target];
			}
			else {
				return this.cell(target).column;
			}
		},
		listType: 'grid',
		cell: function (target, columnId) {
			// summary:
			//		Get the cell object by node, or event, id, plus a columnId

			if (target.column && target.element) {
				return target;
			}

			if (target.target && target.target.nodeType) {
				// event
				target = target.target;
			}
			var element;
			if (target.nodeType) {
				do {
					if (this._rowIdToObject[target.id]) {
						break;
					}
					var colId = target.columnId;
					if (colId) {
						columnId = colId;
						element = target;
						break;
					}
					target = target.parentNode;
				} while (target && target !== this.domNode);
			}
			if (!element && typeof columnId !== 'undefined') {
				var row = this.row(target),
					rowElement = row && row.element;
				if (rowElement) {
					var elements = rowElement.getElementsByTagName('td');
					for (var i = 0; i < elements.length; i++) {
						if (elements[i].columnId === columnId) {
							element = elements[i];
							break;
						}
					}
				}
			}
			if (target != null) {
				return {
					row: row || this.row(target),
					column: columnId && this.column(columnId),
					element: element
				};
			}
		},

		createRowCells: function (tag, each, subRows, object) {
			// summary:
			//		Generates the grid for each row (used by renderHeader and and renderRow)
			var row = put('table.dgrid-row-table[role=presentation]'),
				// IE < 9 needs an explicit tbody; other browsers do not
				tbody = ( 10  < 9) ? put(row, 'tbody') : row,
				tr,
				si, sl, i, l, // iterators
				subRow, column, id, extraClasses, className,
				cell, colSpan, rowSpan; // used inside loops

			// Allow specification of custom/specific subRows, falling back to
			// those defined on the instance.
			subRows = subRows || this.subRows;

			for (si = 0, sl = subRows.length; si < sl; si++) {
				subRow = subRows[si];
				// for single-subrow cases in modern browsers, TR can be skipped
				// http://jsperf.com/table-without-trs
				tr = put(tbody, 'tr');
				if (subRow.className) {
					put(tr, '.' + subRow.className);
				}

				for (i = 0, l = subRow.length; i < l; i++) {
					// iterate through the columns
					column = subRow[i];
					id = column.id;

					extraClasses = column.field ?
						'.field-' + replaceInvalidChars(column.field) :
						'';
					className = typeof column.className === 'function' ?
						column.className(object) : column.className;
					if (className) {
						extraClasses += '.' + className;
					}

					cell = put(tag +
						'.dgrid-cell' +
						(id ? '.dgrid-column-' + replaceInvalidChars(id) : '') +
						extraClasses.replace(/ +/g, '.') +
						'[role=' + (tag === 'th' ? 'columnheader' : 'gridcell') + ']');
					cell.columnId = id;
					colSpan = column.colSpan;
					if (colSpan) {
						cell.colSpan = colSpan;
					}
					rowSpan = column.rowSpan;
					if (rowSpan) {
						cell.rowSpan = rowSpan;
					}
					each(cell, column);
					// add the td to the tr at the end for better performance
					tr.appendChild(cell);
				}
			}
			return row;
		},

		left: function (cell, steps) {
			if (!cell.element) {
				cell = this.cell(cell);
			}
			return this.cell(this._move(cell, -(steps || 1), 'dgrid-cell'));
		},
		right: function (cell, steps) {
			if (!cell.element) {
				cell = this.cell(cell);
			}
			return this.cell(this._move(cell, steps || 1, 'dgrid-cell'));
		},

		_defaultRenderCell: function (object, value, td) {
			// summary:
			//		Default renderCell implementation.
			//		NOTE: Called in context of column definition object.
			// object: Object
			//		The data item for the row currently being rendered
			// value: Mixed
			//		The value of the field applicable to the current cell
			// td: DOMNode
			//		The cell element representing the current item/field
			// options: Object?
			//		Any additional options passed through from renderRow

			if (this.formatter) {
				// Support formatter, with or without formatterScope
				var formatter = this.formatter,
					formatterScope = this.grid.formatterScope;
				td.innerHTML = typeof formatter === 'string' && formatterScope ?
					formatterScope[formatter](value, object) : this.formatter(value, object);
			}
			else if (value != null) {
				td.appendChild(document.createTextNode(value));
			}
		},

		renderRow: function (object, options) {
			var self = this;
			var row = this.createRowCells('td', function (td, column) {
				var data = object;
				// Support get function or field property (similar to DataGrid)
				if (column.get) {
					data = column.get(object);
				}
				else if ('field' in column && column.field !== '_item') {
					data = data[column.field];
				}

				if (column.renderCell) {
					// A column can provide a renderCell method to do its own DOM manipulation,
					// event handling, etc.
					appendIfNode(td, column.renderCell(object, data, td, options));
				}
				else {
					self._defaultRenderCell.call(column, object, data, td, options);
				}
			}, options && options.subRows, object);
			// row gets a wrapper div for a couple reasons:
			// 1. So that one can set a fixed height on rows (heights can't be set on <table>'s AFAICT)
			// 2. So that outline style can be set on a row when it is focused,
			// and Safari's outline style is broken on <table>
			return put('div[role=row]>', row);
		},
		renderHeader: function () {
			// summary:
			//		Setup the headers for the grid
			var grid = this,
				headerNode = this.headerNode,
				i = headerNode.childNodes.length;

			headerNode.setAttribute('role', 'row');

			// clear out existing header in case we're resetting
			while (i--) {
				put(headerNode.childNodes[i], '!');
			}

			var row = this.createRowCells('th', function (th, column) {
				var contentNode = column.headerNode = th;
				var field = column.field;
				if (field) {
					th.field = field;
				}
				// allow for custom header content manipulation
				if (column.renderHeaderCell) {
					appendIfNode(contentNode, column.renderHeaderCell(contentNode));
				}
				else if ('label' in column || column.field) {
					contentNode.appendChild(document.createTextNode(
						'label' in column ? column.label : column.field));
				}
				if (column.sortable !== false && field && field !== '_item') {
					th.sortable = true;
					th.className += ' dgrid-sortable';
				}
			}, this.subRows && this.subRows.headerRows);
			this._rowIdToObject[row.id = this.id + '-header'] = this.columns;
			headerNode.appendChild(row);

			// If the columns are sortable, re-sort on clicks.
			// Use a separate listener property to be managed by renderHeader in case
			// of subsequent calls.
			if (this._sortListener) {
				this._sortListener.remove();
			}
			this._sortListener = listen(row, 'click,keydown', function (event) {
				// respond to click, space keypress, or enter keypress
				if (event.type === 'click' || event.keyCode === 32 ||
						(!has('opera') && event.keyCode === 13)) {
					var target = event.target,
						field, sort, newSort, eventObj;
					do {
						if (target.sortable) {
							// If the click is on the same column as the active sort,
							// reverse sort direction
							newSort = [{
								property: (field = target.field || target.columnId),
								descending: (sort = grid.sort[0]) && sort.property === field &&
									!sort.descending
							}];

							// Emit an event with the new sort
							eventObj = {
								bubbles: true,
								cancelable: true,
								grid: grid,
								parentType: event.type,
								sort: newSort
							};

							if (listen.emit(event.target, 'dgrid-sort', eventObj)) {
								// Stash node subject to DOM manipulations,
								// to be referenced then removed by sort()
								grid._sortNode = target;
								grid.set('sort', newSort);
							}

							break;
						}
					} while ((target = target.parentNode) && target !== headerNode);
				}
			});
		},

		resize: function () {
			// extension of List.resize to allow accounting for
			// column sizes larger than actual grid area
			var headerTableNode = this.headerNode.firstChild,
				contentNode = this.contentNode,
				width;

			this.inherited(arguments);

			// Force contentNode width to match up with header width.
			contentNode.style.width = ''; // reset first
			if (contentNode && headerTableNode) {
				if ((width = headerTableNode.offsetWidth) > contentNode.offsetWidth) {
					// update size of content node if necessary (to match size of rows)
					// (if headerTableNode can't be found, there isn't much we can do)
					contentNode.style.width = width + 'px';
				}
			}
		},

		destroy: function () {
			// Run _destroyColumns first to perform any column plugin tear-down logic.
			this._destroyColumns();
			if (this._sortListener) {
				this._sortListener.remove();
			}

			this.inherited(arguments);
		},

		_setSort: function () {
			// summary:
			//		Extension of List.js sort to update sort arrow in UI

			// Normalize sort first via inherited logic, then update the sort arrow
			this.inherited(arguments);
			this.updateSortArrow(this.sort);
		},

		_findSortArrowParent: function (field) {
			// summary:
			//		Method responsible for finding cell that sort arrow should be
			//		added under.  Called by updateSortArrow; separated for extensibility.

			var columns = this.columns;
			for (var i in columns) {
				var column = columns[i];
				if (column.field === field) {
					return column.headerNode;
				}
			}
		},

		updateSortArrow: function (sort, updateSort) {
			// summary:
			//		Method responsible for updating the placement of the arrow in the
			//		appropriate header cell.  Typically this should not be called (call
			//		set("sort", ...) when actually updating sort programmatically), but
			//		this method may be used by code which is customizing sort (e.g.
			//		by reacting to the dgrid-sort event, canceling it, then
			//		performing logic and calling this manually).
			// sort: Array
			//		Standard sort parameter - array of object(s) containing property name
			//		and optional descending flag
			// updateSort: Boolean?
			//		If true, will update this.sort based on the passed sort array
			//		(i.e. to keep it in sync when custom logic is otherwise preventing
			//		it from being updated); defaults to false

			// Clean up UI from any previous sort
			if (this._lastSortedArrow) {
				// Remove the sort classes from the parent node
				put(this._lastSortedArrow, '<!dgrid-sort-up!dgrid-sort-down');
				// Destroy the lastSortedArrow node
				put(this._lastSortedArrow, '!');
				delete this._lastSortedArrow;
			}

			if (updateSort) {
				this.sort = sort;
			}
			if (!sort[0]) {
				return; // Nothing to do if no sort is specified
			}

			var prop = sort[0].property,
				desc = sort[0].descending,
				// if invoked from header click, target is stashed in _sortNode
				target = this._sortNode || this._findSortArrowParent(prop),
				arrowNode;

			delete this._sortNode;

			// Skip this logic if field being sorted isn't actually displayed
			if (target) {
				target = target.contents || target;
				// Place sort arrow under clicked node, and add up/down sort class
				arrowNode = this._lastSortedArrow = put('div.dgrid-sort-arrow.ui-icon[role=presentation]');
				arrowNode.innerHTML = '&nbsp;';
				target.insertBefore(arrowNode, target.firstChild);
				put(target, desc ? '.dgrid-sort-down' : '.dgrid-sort-up');
				// Call resize in case relocation of sort arrow caused any height changes
				this.resize();
			}
		},

		styleColumn: function (colId, css) {
			// summary:
			//		Dynamically creates a stylesheet rule to alter a column's style.

			return this.addCssRule('#' + miscUtil.escapeCssIdentifier(this.domNode.id) +
				' .dgrid-column-' + replaceInvalidChars(colId), css);
		},

		/*=====
		_configColumn: function (column, rowColumns, prefix) {
			// summary:
			//		Method called when normalizing base configuration of a single
			//		column.  Can be used as an extension point for behavior requiring
			//		access to columns when a new configuration is applied.
		},=====*/

		_configColumns: function (prefix, rowColumns) {
			// configure the current column
			var subRow = [],
				isArray = rowColumns instanceof Array;

			function configColumn(column, columnId) {
				if (typeof column === 'string') {
					rowColumns[columnId] = column = { label: column };
				}
				if (!isArray && !column.field) {
					column.field = columnId;
				}
				columnId = column.id = column.id || (isNaN(columnId) ? columnId : (prefix + columnId));
				// allow further base configuration in subclasses
				if (this._configColumn) {
					this._configColumn(column, rowColumns, prefix);
					// Allow the subclasses to modify the column id.
					columnId = column.id;
				}
				if (isArray) {
					this.columns[columnId] = column;
				}

				// add grid reference to each column object for potential use by plugins
				column.grid = this;
				if (typeof column.init === 'function') {
					kernel.deprecated('colum.init',
						'Column plugins are being phased out in favor of mixins for better extensibility. ' +
							'column.init may be removed in a future release.');
					column.init();
				}

				subRow.push(column); // make sure it can be iterated on
			}

			miscUtil.each(rowColumns, configColumn, this);
			return isArray ? rowColumns : subRow;
		},

		_destroyColumns: function () {
			// summary:
			//		Iterates existing subRows looking for any column definitions with
			//		destroy methods (defined by plugins) and calls them.  This is called
			//		immediately before configuring a new column structure.

			var subRows = this.subRows,
				// If we have column sets, then we don't need to do anything with the missing subRows,
				// ColumnSet will handle it
				subRowsLength = subRows && subRows.length,
				i, j, column, len;

			// First remove rows (since they'll be refreshed after we're done),
			// so that anything aspected onto removeRow by plugins can run.
			// (cleanup will end up running again, but with nothing to iterate.)
			this.cleanup();

			for (i = 0; i < subRowsLength; i++) {
				for (j = 0, len = subRows[i].length; j < len; j++) {
					column = subRows[i][j];
					if (typeof column.destroy === 'function') {
						kernel.deprecated('colum.destroy',
							'Column plugins are being phased out in favor of mixins for better extensibility. ' +
								'column.destroy may be removed in a future release.');
						column.destroy();
					}
				}
			}
		},

		configStructure: function () {
			// configure the columns and subRows
			var subRows = this.subRows,
				columns = this._columns = this.columns;

			// Reset this.columns unless it was already passed in as an object
			this.columns = !columns || columns instanceof Array ? {} : columns;

			if (subRows) {
				// Process subrows, which will in turn populate the this.columns object
				for (var i = 0; i < subRows.length; i++) {
					subRows[i] = this._configColumns(i + '-', subRows[i]);
				}
			}
			else {
				this.subRows = [this._configColumns('', columns)];
			}
		},

		_getColumns: function () {
			// _columns preserves what was passed to set("columns"), but if subRows
			// was set instead, columns contains the "object-ified" version, which
			// was always accessible in the past, so maintain that accessibility going
			// forward.
			return this._columns || this.columns;
		},
		_setColumns: function (columns) {
			this._destroyColumns();
			// reset instance variables
			this.subRows = null;
			this.columns = columns;
			// re-run logic
			this._updateColumns();
		},

		_setSubRows: function (subrows) {
			this._destroyColumns();
			this.subRows = subrows;
			this._updateColumns();
		},

		_updateColumns: function () {
			// summary:
			//		Called when columns, subRows, or columnSets are reset

			this.configStructure();
			this.renderHeader();

			this.refresh();
			// re-render last collection if present
			this._lastCollection && this.renderArray(this._lastCollection);

			// After re-rendering the header, re-apply the sort arrow if needed.
			if (this._started) {
				if (this.sort.length) {
					this.updateSortArrow(this.sort);
				} else {
					// Only call resize directly if we didn't call updateSortArrow,
					// since that calls resize itself when it updates.
					this.resize();
				}
			}
		}
	});

	Grid.appendIfNode = appendIfNode;

	return Grid;
});

},
'dgrid/Tree':function(){
define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/_base/array',
	'dojo/aspect',
	'dojo/on',
	'dojo/query',
	'dojo/when',
	'./util/has-css3',
	'./Grid',
	'dojo/has!touch?./util/touch',
	'put-selector/put'
], function (declare, lang, arrayUtil, aspect, on, querySelector, when, has, Grid, touchUtil, put) {

	return declare(null, {
		// collapseOnRefresh: Boolean
		//		Whether to collapse all expanded nodes any time refresh is called.
		collapseOnRefresh: false,

		// enableTreeTransitions: Boolean
		//		Enables/disables all expand/collapse CSS transitions.
		enableTreeTransitions: true,

		// treeIndentWidth: Number
		//		Width (in pixels) of each level of indentation.
		treeIndentWidth: 9,

		constructor: function () {
			this._treeColumnListeners = [];
		},

		shouldExpand: function (row, level, previouslyExpanded) {
			// summary:
			//		Function called after each row is inserted to determine whether
			//		expand(rowElement, true) should be automatically called.
			//		The default implementation re-expands any rows that were expanded
			//		the last time they were rendered (if applicable).

			return previouslyExpanded;
		},

		expand: function (target, expand, noTransition) {
			// summary:
			//		Expands the row corresponding to the given target.
			// target: Object
			//		Row object (or something resolvable to one) to expand/collapse.
			// expand: Boolean?
			//		If specified, designates whether to expand or collapse the row;
			//		if unspecified, toggles the current state.

			if (!this._treeColumn) {
				return;
			}

			var grid = this,
				row = target.element ? target : this.row(target),
				isExpanded = !!this._expanded[row.id],
				hasTransitionend = has('transitionend'),
				promise;

			target = row.element;
			target = target.className.indexOf('dgrid-expando-icon') > -1 ? target :
				querySelector('.dgrid-expando-icon', target)[0];

			noTransition = noTransition || !this.enableTreeTransitions;

			if (target && target.mayHaveChildren && (noTransition || expand !== isExpanded)) {
				// toggle or set expand/collapsed state based on optional 2nd argument
				var expanded = expand === undefined ? !this._expanded[row.id] : expand;

				// update the expando display
				put(target, '.ui-icon-triangle-1-' + (expanded ? 'se' : 'e') +
					'!ui-icon-triangle-1-' + (expanded ? 'e' : 'se'));
				put(row.element, (expanded ? '.' : '!') + 'dgrid-row-expanded');

				var rowElement = row.element,
					container = rowElement.connected,
					containerStyle,
					scrollHeight,
					options = {};

				if (!container) {
					// if the children have not been created, create a container, a preload node and do the
					// query for the children
					container = options.container = rowElement.connected =
						put(rowElement, '+div.dgrid-tree-container');
					var query = function (options) {
						var childCollection = grid._renderedCollection.getChildren(row.data),
							results;
						if (grid.sort) {
							childCollection = childCollection.sort(grid.sort);
						}
						if (childCollection.track && grid.shouldTrackCollection) {
							container._rows = options.rows = [];

							childCollection = childCollection.track();

							// remember observation handles so they can be removed when the parent row is destroyed
							container._handles = [
								childCollection.tracking,
								grid._observeCollection(childCollection, container, options)
							];
						}
						if ('start' in options) {
							var rangeArgs = {
								start: options.start,
								end: options.start + options.count
							};
							results = childCollection.fetchRange(rangeArgs);
						} else {
							results = childCollection.fetch();
						}
						return results;
					};
					// Include level information on query for renderQuery case
					if ('level' in target) {
						query.level = target.level;
					}

					// Add the query to the promise chain
					if (this.renderQuery) {
						promise = this.renderQuery(query, options);
					}
					else {
						// If not using OnDemandList, we don't need preload nodes,
						// but we still need a beforeNode to pass to renderArray,
						// so create a temporary one
						var firstChild = put(container, 'div');
						promise = this._trackError(function () {
							return grid.renderQueryResults(
								query(options),
								firstChild,
								lang.mixin({ rows: options.rows },
									'level' in query ? { queryLevel: query.level } : null
								)
							).then(function (rows) {
								put(firstChild, '!');
								return rows;
							});
						});
					}

					if (hasTransitionend && !noTransition) {
						on.once(container, hasTransitionend, this._onTreeTransitionEnd);
					}
					else {
						this._onTreeTransitionEnd.call(container);
					}
				}

				// Show or hide all the children.

				container.hidden = !expanded;
				containerStyle = container.style;

				// make sure it is visible so we can measure it
				if (!hasTransitionend || noTransition) {
					containerStyle.display = expanded ? 'block' : 'none';
					containerStyle.height = '';
				}
				else {
					if (expanded) {
						containerStyle.display = 'block';
						scrollHeight = container.scrollHeight;
						containerStyle.height = '0px';
					}
					else {
						// if it will be hidden we need to be able to give a full height
						// without animating it, so it has the right starting point to animate to zero
						put(container, '.dgrid-tree-resetting');
						containerStyle.height = container.scrollHeight + 'px';
					}
					// Perform a transition for the expand or collapse.
					setTimeout(function () {
						put(container, '!dgrid-tree-resetting');
						containerStyle.height =
							expanded ? (scrollHeight ? scrollHeight + 'px' : 'auto') : '0px';
					}, 0);
				}

				// Update _expanded map.
				if (expanded) {
					this._expanded[row.id] = true;
				}
				else {
					delete this._expanded[row.id];
				}
			}

			// Always return a promise
			return when(promise);
		},

		_configColumns: function () {
			var columnArray = this.inherited(arguments);

			// Set up hash to store IDs of expanded rows (here rather than in
			// _configureTreeColumn so nothing breaks if no column has renderExpando)
			this._expanded = {};

			for (var i = 0, l = columnArray.length; i < l; i++) {
				if (columnArray[i].renderExpando) {
					this._configureTreeColumn(columnArray[i]);
					break; // Allow only one tree column.
				}
			}
			return columnArray;
		},

		insertRow: function () {
			var rowElement = this.inherited(arguments);

			// Auto-expand (shouldExpand) considerations
			var row = this.row(rowElement),
				expanded = this.shouldExpand(row, this._currentLevel, this._expanded[row.id]);

			if (expanded) {
				this.expand(rowElement, true, true);
			}

			return rowElement; // pass return value through
		},

		removeRow: function (rowElement, preserveDom) {
			var connected = rowElement.connected,
				childOptions = {};
			if (connected) {
				if (connected._handles) {
					arrayUtil.forEach(connected._handles, function (handle) {
						handle.remove();
					});
					delete connected._handles;
				}

				if (connected._rows) {
					childOptions.rows = connected._rows;
				}

				querySelector('>.dgrid-row', connected).forEach(function (element) {
					this.removeRow(element, true, childOptions);
				}, this);

				if (connected._rows) {
					connected._rows.length = 0;
					delete connected._rows;
				}

				if (!preserveDom) {
					put(connected, '!');
				}
			}

			this.inherited(arguments);
		},

		cleanup: function () {
			this.inherited(arguments);

			if (this.collapseOnRefresh) {
				// Clear out the _expanded hash on each call to cleanup
				// (which generally coincides with refreshes, as well as destroy)
				this._expanded = {};
			}
		},

		_destroyColumns: function () {
			var listeners = this._treeColumnListeners;

			for (var i = listeners.length; i--;) {
				listeners[i].remove();
			}
			this._treeColumnListeners = [];
			this._treeColumn = null;
		},

		_calcRowHeight: function (rowElement) {
			// Override this method to provide row height measurements that
			// include the children of a row
			var connected = rowElement.connected;
			// if connected, need to consider this in the total row height
			return this.inherited(arguments) + (connected ? connected.offsetHeight : 0);
		},

		_configureTreeColumn: function (column) {
			// summary:
			//		Adds tree navigation capability to a column.

			var originalRenderCell = column.renderCell || this._defaultRenderCell;
			var clicked; // tracks row that was clicked (for expand dblclick event handling)

			this._treeColumn = column;

			var grid = this,
				colSelector = '.dgrid-content .dgrid-column-' + column.id;

			if (!grid.collection) {
				throw new Error('dgrid Tree mixin requires a collection to operate.');
			}

			if (typeof column.renderExpando !== 'function') {
				column.renderExpando = this._defaultRenderExpando;
			}

			// Set up the event listener once and use event delegation for better memory use.
			this._treeColumnListeners.push(this.on(column.expandOn ||
					'.dgrid-expando-icon:click,' + colSelector + ':dblclick,' + colSelector + ':keydown',
				function (event) {
					var row = grid.row(event);
					if ((!grid.collection.mayHaveChildren || grid.collection.mayHaveChildren(row.data)) &&
						(event.type !== 'keydown' || event.keyCode === 32) && !(event.type === 'dblclick' &&
							clicked && clicked.count > 1 && row.id === clicked.id &&
							event.target.className.indexOf('dgrid-expando-icon') > -1)) {
						grid.expand(row);
					}

					// If the expando icon was clicked, update clicked object to prevent
					// potential over-triggering on dblclick (all tested browsers but IE < 9).
					if (event.target.className.indexOf('dgrid-expando-icon') > -1) {
						if (clicked && clicked.id === grid.row(event).id) {
							clicked.count++;
						}
						else {
							clicked = {
								id: grid.row(event).id,
								count: 1
							};
						}
					}
				})
			);

			if (has('touch')) {
				// Also listen on double-taps of the cell.
				this._treeColumnListeners.push(this.on(touchUtil.selector(colSelector, touchUtil.dbltap),
					function () {
						grid.expand(this);
					}));
			}

			column.renderCell = function (object, value, td, options) {
				// summary:
				//		Renders a cell that can be expanded, creating more rows

				var grid = column.grid,
					level = Number(options && options.queryLevel) + 1,
					mayHaveChildren = !grid.collection.mayHaveChildren || grid.collection.mayHaveChildren(object),
					expando, node;

				level = grid._currentLevel = isNaN(level) ? 0 : level;
				expando = column.renderExpando(level, mayHaveChildren,
					grid._expanded[grid.collection.getIdentity(object)], object);
				expando.level = level;
				expando.mayHaveChildren = mayHaveChildren;

				node = originalRenderCell.call(column, object, value, td, options);
				if (node && node.nodeType) {
					put(td, expando);
					put(td, node);
				}
				else {
					td.insertBefore(expando, td.firstChild);
				}
			};
		},

		_defaultRenderExpando: function (level, hasChildren, expanded) {
			// summary:
			//		Default implementation for column.renderExpando.
			//		NOTE: Called in context of the column definition object.
			// level: Number
			//		Level of indentation for this row (0 for top-level)
			// hasChildren: Boolean
			//		Whether this item may have children (in most cases this determines
			//		whether an expando icon should be rendered)
			// expanded: Boolean
			//		Whether this item is currently in expanded state
			// object: Object
			//		The item that this expando pertains to

			var dir = this.grid.isRTL ? 'right' : 'left',
				cls = '.dgrid-expando-icon',
				node;
			if (hasChildren) {
				cls += '.ui-icon.ui-icon-triangle-1-' + (expanded ? 'se' : 'e');
			}
			node = put('div' + cls + '[style=margin-' + dir + ': ' +
				(level * this.grid.treeIndentWidth) + 'px; float: ' + dir + ']');
			node.innerHTML = '&nbsp;';
			return node;
		},

		_onTreeTransitionEnd: function (event) {
			var container = this,
				height = this.style.height;
			if (height) {
				// After expansion, ensure display is correct;
				// after collapse, set display to none to improve performance
				this.style.display = height === '0px' ? 'none' : 'block';
			}

			// Reset height to be auto, so future height changes (from children
			// expansions, for example), will expand to the right height.
			if (event) {
				// For browsers with CSS transition support, setting the height to
				// auto or "" will cause an animation to zero height for some
				// reason, so temporarily set the transition to be zero duration
				put(this, '.dgrid-tree-resetting');
				setTimeout(function () {
					// Turn off the zero duration transition after we have let it render
					put(container, '!dgrid-tree-resetting');
				}, 0);
			}
			// Now set the height to auto
			this.style.height = '';
		}
	});
});

},
'dgrid/util/has-css3':function(){
define([
	'dojo/has'
], function (has) {
	// This module defines feature tests for CSS3 features such as transitions.
	// The css-transitions, css-transforms, and css-transforms3d has-features
	// can report either boolean or string:
	// * false indicates no support
	// * true indicates prefix-less support
	// * string indicates the vendor prefix under which the feature is supported

	var cssPrefixes = ['ms', 'O', 'Moz', 'Webkit'];

	function testStyle(element, property) {
		var style = element.style,
			i;

		if (property in style) {
			// Standard, no prefix
			return true;
		}
		property = property.slice(0, 1).toUpperCase() + property.slice(1);
		for (i = cssPrefixes.length; i--;) {
			if ((cssPrefixes[i] + property) in style) {
				// Vendor-specific css property prefix
				return cssPrefixes[i];
			}
		}

		// Otherwise, not supported
		return false;
	}

	has.add('css-transitions', function (global, doc, element) {
		return testStyle(element, 'transitionProperty');
	});

	has.add('css-transforms', function (global, doc, element) {
		return testStyle(element, 'transform');
	});

	has.add('css-transforms3d', function (global, doc, element) {
		return testStyle(element, 'perspective');
	});

	has.add('transitionend', function () {
		// Infer transitionend event name based on CSS transitions has-feature.
		var tpfx = has('css-transitions');
		if (!tpfx) {
			return false;
		}
		if (tpfx === true) {
			return 'transitionend';
		}
		return {
			ms: 'MSTransitionEnd',
			O: 'oTransitionEnd',
			Moz: 'transitionend',
			Webkit: 'webkitTransitionEnd'
		}[tpfx];
	});

	return has;
});

},
'dgrid/Selection':function(){
define([
	'dojo/_base/declare',
	'dojo/on',
	'dojo/has',
	'dojo/aspect',
	'./List',
	'dojo/has!touch?./util/touch',
	'put-selector/put',
	'dojo/query',
	'dojo/_base/sniff'
], function (declare, on, has, aspect, List, touchUtil, put) {

	has.add('dom-comparedocumentposition', function (global, doc, element) {
		return !!element.compareDocumentPosition;
	});

	// Add feature test for user-select CSS property for optionally disabling
	// text selection.
	// (Can't use dom.setSelectable prior to 1.8.2 because of bad sniffs, see #15990)
	has.add('css-user-select', function (global, doc, element) {
		var style = element.style,
			prefixes = ['Khtml', 'O', 'ms', 'Moz', 'Webkit'],
			i = prefixes.length,
			name = 'userSelect';

		// Iterate prefixes from most to least likely
		do {
			if (typeof style[name] !== 'undefined') {
				// Supported; return property name
				return name;
			}
		} while (i-- && (name = prefixes[i] + 'UserSelect'));

		// Not supported if we didn't return before now
		return false;
	});

	// Also add a feature test for the onselectstart event, which offers a more
	// graceful fallback solution than node.unselectable.
	has.add('dom-selectstart', typeof document.onselectstart !== 'undefined');

	var ctrlEquiv = has('mac') ? 'metaKey' : 'ctrlKey',
		hasUserSelect = has('css-user-select'),
		hasPointer = has('pointer'),
		hasMSPointer = hasPointer && hasPointer.slice(0, 2) === 'MS',
		downType = hasPointer ? hasPointer + (hasMSPointer ? 'Down' : 'down') : 'mousedown',
		upType = hasPointer ? hasPointer + (hasMSPointer ? 'Up' : 'up') : 'mouseup';

	function makeUnselectable(node, unselectable) {
		// Utility function used in fallback path for recursively setting unselectable
		var value = node.unselectable = unselectable ? 'on' : '',
			elements = node.getElementsByTagName('*'),
			i = elements.length;

		while (--i) {
			if (elements[i].tagName === 'INPUT' || elements[i].tagName === 'TEXTAREA') {
				continue; // Don't prevent text selection in text input fields.
			}
			elements[i].unselectable = value;
		}
	}

	function setSelectable(grid, selectable) {
		// Alternative version of dojo/dom.setSelectable based on feature detection.

		// For FF < 21, use -moz-none, which will respect -moz-user-select: text on
		// child elements (e.g. form inputs).  In FF 21, none behaves the same.
		// See https://developer.mozilla.org/en-US/docs/CSS/user-select
		var node = grid.bodyNode,
			value = selectable ? 'text' : has('ff') < 21 ? '-moz-none' : 'none';

		// In IE10+, -ms-user-select: none will block selection from starting within the
		// element, but will not block an existing selection from entering the element.
		// When using a modifier key, IE will select text inside of the element as well
		// as outside of the element, because it thinks the selection started outside.
		// Therefore, fall back to other means of blocking selection for IE10+.
		if (hasUserSelect && hasUserSelect !== 'msUserSelect') {
			node.style[hasUserSelect] = value;
		}
		else if (has('dom-selectstart')) {
			// For browsers that don't support user-select but support selectstart (IE<10),
			// we can hook up an event handler as necessary.  Since selectstart bubbles,
			// it will handle any child elements as well.
			// Note, however, that both this and the unselectable fallback below are
			// incapable of preventing text selection from outside the targeted node.
			if (!selectable && !grid._selectstartHandle) {
				grid._selectstartHandle = on(node, 'selectstart', function (evt) {
					var tag = evt.target && evt.target.tagName;

					// Prevent selection except where a text input field is involved.
					if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
						evt.preventDefault();
					}
				});
			}
			else if (selectable && grid._selectstartHandle) {
				grid._selectstartHandle.remove();
				delete grid._selectstartHandle;
			}
		}
		else {
			// For browsers that don't support either user-select or selectstart (Opera),
			// we need to resort to setting the unselectable attribute on all nodes
			// involved.  Since this doesn't automatically apply to child nodes, we also
			// need to re-apply it whenever rows are rendered.
			makeUnselectable(node, !selectable);
			if (!selectable && !grid._unselectableHandle) {
				grid._unselectableHandle = aspect.after(grid, 'renderRow', function (row) {
					makeUnselectable(row, true);
					return row;
				});
			}
			else if (selectable && grid._unselectableHandle) {
				grid._unselectableHandle.remove();
				delete grid._unselectableHandle;
			}
		}
	}

	return declare(null, {
		// summary:
		//		Add selection capabilities to a grid. The grid will have a selection property and
		//		fire "dgrid-select" and "dgrid-deselect" events.

		// selectionDelegate: String
		//		Selector to delegate to as target of selection events.
		selectionDelegate: '.dgrid-row',

		// selectionEvents: String|Function
		//		Event (or comma-delimited events, or extension event) to listen on
		//		to trigger select logic.
		selectionEvents: downType + ',' + upType + ',dgrid-cellfocusin',

		// selectionTouchEvents: String|Function
		//		Event (or comma-delimited events, or extension event) to listen on
		//		in addition to selectionEvents for touch devices.
		selectionTouchEvents: has('touch') ? touchUtil.tap : null,

		// deselectOnRefresh: Boolean
		//		If true, the selection object will be cleared when refresh is called.
		deselectOnRefresh: true,

		// allowSelectAll: Boolean
		//		If true, allow ctrl/cmd+A to select all rows.
		//		Also consulted by the selector plugin for showing select-all checkbox.
		allowSelectAll: false,

		// selection:
		//		An object where the property names correspond to
		//		object ids and values are true or false depending on whether an item is selected
		selection: {},

		// selectionMode: String
		//		The selection mode to use, can be "none", "multiple", "single", or "extended".
		selectionMode: 'extended',

		// allowTextSelection: Boolean
		//		Whether to still allow text within cells to be selected.  The default
		//		behavior is to allow text selection only when selectionMode is none;
		//		setting this property to either true or false will explicitly set the
		//		behavior regardless of selectionMode.
		allowTextSelection: undefined,

		// _selectionTargetType: String
		//		Indicates the property added to emitted events for selected targets;
		//		overridden in CellSelection
		_selectionTargetType: 'rows',

		create: function () {
			this.selection = {};
			return this.inherited(arguments);
		},
		postCreate: function () {
			this.inherited(arguments);

			this._initSelectionEvents();

			// Force selectionMode setter to run
			var selectionMode = this.selectionMode;
			this.selectionMode = '';
			this._setSelectionMode(selectionMode);
		},

		destroy: function () {
			this.inherited(arguments);

			// Remove any extra handles added by Selection.
			if (this._selectstartHandle) {
				this._selectstartHandle.remove();
			}
			if (this._unselectableHandle) {
				this._unselectableHandle.remove();
			}
			if (this._removeDeselectSignals) {
				this._removeDeselectSignals();
			}
		},

		_setSelectionMode: function (mode) {
			// summary:
			//		Updates selectionMode, resetting necessary variables.

			if (mode === this.selectionMode) {
				return;
			}

			// Start selection fresh when switching mode.
			this.clearSelection();

			this.selectionMode = mode;

			// Compute name of selection handler for this mode once
			// (in the form of _fooSelectionHandler)
			this._selectionHandlerName = '_' + mode + 'SelectionHandler';

			// Also re-run allowTextSelection setter in case it is in automatic mode.
			this._setAllowTextSelection(this.allowTextSelection);
		},

		_setAllowTextSelection: function (allow) {
			if (typeof allow !== 'undefined') {
				setSelectable(this, allow);
			}
			else {
				setSelectable(this, this.selectionMode === 'none');
			}
			this.allowTextSelection = allow;
		},

		_handleSelect: function (event, target) {
			// Don't run if selection mode doesn't have a handler (incl. "none"), target can't be selected,
			// or if coming from a dgrid-cellfocusin from a mousedown
			if (!this[this._selectionHandlerName] || !this.allowSelect(this.row(target)) ||
					(event.type === 'dgrid-cellfocusin' && event.parentType === 'mousedown') ||
					(event.type === upType && target !== this._waitForMouseUp)) {
				return;
			}
			this._waitForMouseUp = null;
			this._selectionTriggerEvent = event;

			// Don't call select handler for ctrl+navigation
			if (!event.keyCode || !event.ctrlKey || event.keyCode === 32) {
				// If clicking a selected item, wait for mouseup so that drag n' drop
				// is possible without losing our selection
				if (!event.shiftKey && event.type === downType && this.isSelected(target)) {
					this._waitForMouseUp = target;
				}
				else {
					this[this._selectionHandlerName](event, target);
				}
			}
			this._selectionTriggerEvent = null;
		},

		_singleSelectionHandler: function (event, target) {
			// summary:
			//		Selection handler for "single" mode, where only one target may be
			//		selected at a time.

			var ctrlKey = event.keyCode ? event.ctrlKey : event[ctrlEquiv];
			if (this._lastSelected === target) {
				// Allow ctrl to toggle selection, even within single select mode.
				this.select(target, null, !ctrlKey || !this.isSelected(target));
			}
			else {
				this.clearSelection();
				this.select(target);
				this._lastSelected = target;
			}
		},

		_multipleSelectionHandler: function (event, target) {
			// summary:
			//		Selection handler for "multiple" mode, where shift can be held to
			//		select ranges, ctrl/cmd can be held to toggle, and clicks/keystrokes
			//		without modifier keys will add to the current selection.

			var lastRow = this._lastSelected,
				ctrlKey = event.keyCode ? event.ctrlKey : event[ctrlEquiv],
				value;

			if (!event.shiftKey) {
				// Toggle if ctrl is held; otherwise select
				value = ctrlKey ? null : true;
				lastRow = null;
			}
			this.select(target, lastRow, value);

			if (!lastRow) {
				// Update reference for potential subsequent shift+select
				// (current row was already selected above)
				this._lastSelected = target;
			}
		},

		_extendedSelectionHandler: function (event, target) {
			// summary:
			//		Selection handler for "extended" mode, which is like multiple mode
			//		except that clicks/keystrokes without modifier keys will clear
			//		the previous selection.

			// Clear selection first for right-clicks outside selection and non-ctrl-clicks;
			// otherwise, extended mode logic is identical to multiple mode
			if (event.button === 2 ? !this.isSelected(target) :
					!(event.keyCode ? event.ctrlKey : event[ctrlEquiv])) {
				this.clearSelection(null, true);
			}
			this._multipleSelectionHandler(event, target);
		},

		_toggleSelectionHandler: function (event, target) {
			// summary:
			//		Selection handler for "toggle" mode which simply toggles the selection
			//		of the given target.  Primarily useful for touch input.

			this.select(target, null, null);
		},

		_initSelectionEvents: function () {
			// summary:
			//		Performs first-time hookup of event handlers containing logic
			//		required for selection to operate.

			var grid = this,
				contentNode = this.contentNode,
				selector = this.selectionDelegate;

			this._selectionEventQueues = {
				deselect: [],
				select: []
			};

			if (has('touch') && !has('pointer') && this.selectionTouchEvents) {
				// Listen for taps, and also for mouse/keyboard, making sure not
				// to trigger both for the same interaction
				on(contentNode, touchUtil.selector(selector, this.selectionTouchEvents), function (evt) {
					grid._handleSelect(evt, this);
					grid._ignoreMouseSelect = this;
				});
				on(contentNode, on.selector(selector, this.selectionEvents), function (event) {
					if (grid._ignoreMouseSelect !== this) {
						grid._handleSelect(event, this);
					}
					else if (event.type === upType) {
						grid._ignoreMouseSelect = null;
					}
				});
			}
			else {
				// Listen for mouse/keyboard actions that should cause selections
				on(contentNode, on.selector(selector, this.selectionEvents), function (event) {
					grid._handleSelect(event, this);
				});
			}

			// Also hook up spacebar (for ctrl+space)
			if (this.addKeyHandler) {
				this.addKeyHandler(32, function (event) {
					grid._handleSelect(event, event.target);
				});
			}

			// If allowSelectAll is true, bind ctrl/cmd+A to (de)select all rows,
			// unless the event was received from an editor component.
			// (Handler further checks against _allowSelectAll, which may be updated
			// if selectionMode is changed post-init.)
			if (this.allowSelectAll) {
				this.on('keydown', function (event) {
					if (event[ctrlEquiv] && event.keyCode === 65 &&
							!/\bdgrid-input\b/.test(event.target.className)) {
						event.preventDefault();
						grid[grid.allSelected ? 'clearSelection' : 'selectAll']();
					}
				});
			}

			// Update aspects if there is a collection change
			if (this._setCollection) {
				aspect.before(this, '_setCollection', function (collection) {
					grid._updateDeselectionAspect(collection);
				});
			}
			this._updateDeselectionAspect();
		},

		_updateDeselectionAspect: function (collection) {
			// summary:
			//		Hooks up logic to handle deselection of removed items.
			//		Aspects to a trackable collection's notify method if applicable,
			//		or to the list/grid's removeRow method otherwise.

			var self = this,
				signals;

			function ifSelected(rowArg, methodName) {
				// Calls a method if the row corresponding to the object is selected.
				var row = self.row(rowArg),
					selection = row && self.selection[row.id];
				// Is the row currently in the selection list.
				if (selection) {
					self[methodName](row);
				}
			}

			// Remove anything previously configured
			if (this._removeDeselectSignals) {
				this._removeDeselectSignals();
			}

			if (collection && collection.track && this._observeCollection) {
				signals = [
					aspect.before(this, '_observeCollection', function (collection) {
						signals.push(
							collection.on('delete', function (event) {
								if (typeof event.index === 'undefined') {
									// Call deselect on the row if the object is being removed.  This allows the
									// deselect event to reference the row element while it still exists in the DOM.
									ifSelected(event.id, 'deselect');
								}
							})
						);
					}),
					aspect.after(this, '_observeCollection', function (collection) {
						signals.push(
							collection.on('update', function (event) {
								if (typeof event.index !== 'undefined') {
									// When List updates an item, the row element is removed and a new one inserted.
									// If at this point the object is still in grid.selection,
									// then call select on the row so the element's CSS is updated.
									ifSelected(collection.getIdentity(event.target), 'select');
								}
							})
						);
					}, true)
				];
			}
			else {
				signals = [
					aspect.before(this, 'removeRow', function (rowElement, preserveDom) {
						var row;
						if (!preserveDom) {
							row = this.row(rowElement);
							// if it is a real row removal for a selected item, deselect it
							if (row && (row.id in this.selection)) {
								this.deselect(row);
							}
						}
					})
				];
			}

			this._removeDeselectSignals = function () {
				for (var i = signals.length; i--;) {
					signals[i].remove();
				}
				signals = [];
			};
		},

		allowSelect: function () {
			// summary:
			//		A method that can be overriden to determine whether or not a row (or
			//		cell) can be selected. By default, all rows (or cells) are selectable.
			// target: Object
			//		Row object (for Selection) or Cell object (for CellSelection) for the
			//		row/cell in question
			return true;
		},

		_fireSelectionEvent: function (type) {
			// summary:
			//		Fires an event for the accumulated rows once a selection
			//		operation is finished (whether singular or for a range)

			var queue = this._selectionEventQueues[type],
				triggerEvent = this._selectionTriggerEvent,
				eventObject;

			eventObject = {
				bubbles: true,
				grid: this
			};
			if (triggerEvent) {
				eventObject.parentType = triggerEvent.type;
			}
			eventObject[this._selectionTargetType] = queue;

			// Clear the queue so that the next round of (de)selections starts anew
			this._selectionEventQueues[type] = [];

			on.emit(this.contentNode, 'dgrid-' + type, eventObject);
		},

		_fireSelectionEvents: function () {
			var queues = this._selectionEventQueues,
				type;

			for (type in queues) {
				if (queues[type].length) {
					this._fireSelectionEvent(type);
				}
			}
		},

		_select: function (row, toRow, value) {
			// summary:
			//		Contains logic for determining whether to select targets, but
			//		does not emit events.  Called from select, deselect, selectAll,
			//		and clearSelection.

			var selection,
				previousValue,
				element,
				toElement,
				direction;

			if (typeof value === 'undefined') {
				// default to true
				value = true;
			}
			if (!row.element) {
				row = this.row(row);
			}

			// Check whether we're allowed to select the given row before proceeding.
			// If a deselect operation is being performed, this check is skipped,
			// to avoid errors when changing column definitions, and since disabled
			// rows shouldn't ever be selected anyway.
			if (value === false || this.allowSelect(row)) {
				selection = this.selection;
				previousValue = !!selection[row.id];
				if (value === null) {
					// indicates a toggle
					value = !previousValue;
				}
				element = row.element;
				if (!value && !this.allSelected) {
					delete this.selection[row.id];
				}
				else {
					selection[row.id] = value;
				}
				if (element) {
					// add or remove classes as appropriate
					if (value) {
						put(element, '.dgrid-selected' +
							(this.addUiClasses ? '.ui-state-active' : ''));
					}
					else {
						put(element, '!dgrid-selected!ui-state-active');
					}
				}
				if (value !== previousValue && element) {
					// add to the queue of row events
					this._selectionEventQueues[(value ? '' : 'de') + 'select'].push(row);
				}

				if (toRow) {
					if (!toRow.element) {
						toRow = this.row(toRow);
					}

					if (!toRow) {
						this._lastSelected = element;
						console.warn('The selection range has been reset because the ' +
							'beginning of the selection is no longer in the DOM. ' +
							'If you are using OnDemandList, you may wish to increase ' +
							'farOffRemoval to avoid this, but note that keeping more nodes ' +
							'in the DOM may impact performance.');
						return;
					}

					toElement = toRow.element;
					if (toElement) {
						direction = this._determineSelectionDirection(element, toElement);
						if (!direction) {
							// The original element was actually replaced
							toElement = document.getElementById(toElement.id);
							direction = this._determineSelectionDirection(element, toElement);
						}
						while (row.element !== toElement && (row = this[direction](row))) {
							this._select(row, null, value);
						}
					}
				}
			}
		},

		// Implement _determineSelectionDirection differently based on whether the
		// browser supports element.compareDocumentPosition; use sourceIndex for IE<9
		_determineSelectionDirection: has('dom-comparedocumentposition') ? function (from, to) {
			var result = to.compareDocumentPosition(from);
			if (result & 1) {
				return false; // Out of document
			}
			return result === 2 ? 'down' : 'up';
		} : function (from, to) {
			if (to.sourceIndex < 1) {
				return false; // Out of document
			}
			return to.sourceIndex > from.sourceIndex ? 'down' : 'up';
		},

		select: function (row, toRow, value) {
			// summary:
			//		Selects or deselects the given row or range of rows.
			// row: Mixed
			//		Row object (or something that can resolve to one) to (de)select
			// toRow: Mixed
			//		If specified, the inclusive range between row and toRow will
			//		be (de)selected
			// value: Boolean|Null
			//		Whether to select (true/default), deselect (false), or toggle
			//		(null) the row

			this._select(row, toRow, value);
			this._fireSelectionEvents();
		},
		deselect: function (row, toRow) {
			// summary:
			//		Deselects the given row or range of rows.
			// row: Mixed
			//		Row object (or something that can resolve to one) to deselect
			// toRow: Mixed
			//		If specified, the inclusive range between row and toRow will
			//		be deselected

			this.select(row, toRow, false);
		},

		clearSelection: function (exceptId, dontResetLastSelected) {
			// summary:
			//		Deselects any currently-selected items.
			// exceptId: Mixed?
			//		If specified, the given id will not be deselected.

			this.allSelected = false;
			for (var id in this.selection) {
				if (exceptId !== id) {
					this._select(id, null, false);
				}
			}
			if (!dontResetLastSelected) {
				this._lastSelected = null;
			}
			this._fireSelectionEvents();
		},
		selectAll: function () {
			this.allSelected = true;
			this.selection = {}; // we do this to clear out pages from previous sorts
			for (var i in this._rowIdToObject) {
				var row = this.row(this._rowIdToObject[i]);
				this._select(row.id, null, true);
			}
			this._fireSelectionEvents();
		},

		isSelected: function (object) {
			// summary:
			//		Returns true if the indicated row is selected.

			if (typeof object === 'undefined' || object === null) {
				return false;
			}
			if (!object.element) {
				object = this.row(object);
			}

			// First check whether the given row is indicated in the selection hash;
			// failing that, check if allSelected is true (testing against the
			// allowSelect method if possible)
			return (object.id in this.selection) ? !!this.selection[object.id] :
				this.allSelected && (!object.data || this.allowSelect(object));
		},

		refresh: function () {
			if (this.deselectOnRefresh) {
				this.clearSelection();
			}
			this._lastSelected = null;
			return this.inherited(arguments);
		},

		renderArray: function () {
			var rows = this.inherited(arguments),
				selection = this.selection,
				i,
				row,
				selected;

			for (i = 0; i < rows.length; i++) {
				row = this.row(rows[i]);
				selected = row.id in selection ? selection[row.id] : this.allSelected;
				if (selected) {
					this.select(row, null, selected);
				}
			}
			this._fireSelectionEvents();
			return rows;
		}
	});
});

},
'dgrid/Selector':function(){
define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/_base/sniff',
	'./Selection',
	'put-selector/put'
], function (declare, lang, has, Selection, put) {

	return declare(Selection, {
		// summary:
		//		Adds an input field (checkbox or radio) to a column that when checked, selects the row
		//		that contains the input field.  To enable, add a "selector" property to a column definition.
		//
		// description:
		//		The selector property should contain "checkbox", "radio", or be a function that renders the input.
		//		If set to "radio", the input field will be a radio button and only one input in the column will be
		//		checked.  If the value of selector is a function, then the function signature is
		//		renderSelectorInput(column, value, cell, object) where:
		//		* column - the column definition
		//		* value - the cell's value
		//		* cell - the cell's DOM node
		//		* object - the row's data object
		//		The custom renderSelectorInput function must return an input field.

		postCreate: function () {
			this.inherited(arguments);

			// Register one listener at the top level that receives events delegated
			this.on('.dgrid-selector:click,.dgrid-selector:keydown', lang.hitch(this, '_handleSelectorClick'));
			// Register listeners to the select and deselect events to change the input checked value
			this.on('dgrid-select', lang.hitch(this, '_changeSelectorInput', true));
			this.on('dgrid-deselect', lang.hitch(this, '_changeSelectorInput', false));
		},

		_defaultRenderSelectorInput: function (column, selected, cell, object) {
			var parent = cell.parentNode;
			var grid = column.grid;

			// Must set the class name on the outer cell in IE for keystrokes to be intercepted
			put(parent && parent.contents ? parent : cell, '.dgrid-selector');
			var input = cell.input || (cell.input = put(cell, 'input[type=' + column.selector + ']', {
				tabIndex: isNaN(column.tabIndex) ? -1 : column.tabIndex,
				disabled: !grid.allowSelect(grid.row(object)),
				checked: selected
			}));
			input.setAttribute('aria-checked', selected);

			return input;
		},

		_configureSelectorColumn: function (column) {
			var self = this;
			var selector = column.selector;

			this._selectorColumns.push(column);
			this._selectorSingleRow = this._selectorSingleRow || column.selector === 'radio';

			var renderSelectorInput = typeof selector === 'function' ?
				selector : this._defaultRenderSelectorInput;

			column.sortable = false;

			column.renderCell = function (object, value, cell) {
				var row = object && self.row(object);
				value = row && self.selection[row.id];
				renderSelectorInput(column, !!value, cell, object);
			};

			column.renderHeaderCell = function (th) {
				var label = 'label' in column ? column.label : column.field || '';

				if (column.selector === 'radio' || !self.allowSelectAll) {
					th.appendChild(document.createTextNode(label));
				}
				else {
					column._selectorHeaderCheckbox = renderSelectorInput(column, false, th, {});
					self._hasSelectorHeaderCheckbox = true;
				}
			};
		},

		_handleSelectorClick: function (event) {
			var cell = this.cell(event);
			var row = cell.row;

			// We would really only care about click, since other input sources like spacebar
			// trigger a click, but the click event doesn't provide access to the shift key in firefox, so
			// listen for keydown as well to get an event in firefox that we can properly retrieve
			// the shiftKey property
			if (event.type === 'click' || event.keyCode === 32 ||
				(!has('opera') && event.keyCode === 13) || event.keyCode === 0) {

				this._selectionTriggerEvent = event;

				if (row) {
					if (this.allowSelect(row)) {
						var lastRow = this._lastSelected && this.row(this._lastSelected);

						if (this._selectorSingleRow) {
							if (!lastRow || lastRow.id !== row.id) {
								this.clearSelection();
								this.select(row, null, true);
								this._lastSelected = row.element;
							}
						}
						else {
							if (row) {
								if (event.shiftKey) {
									// Make sure the last input always ends up checked for shift key
									this._changeSelectorInput(true, {rows: [row]});
								}
								else {
									// No shift key, so no range selection
									lastRow = null;
								}
								lastRow = event.shiftKey ? lastRow : null;
								this.select(lastRow || row, row, lastRow ? undefined : null);
								this._lastSelected = row.element;
							}
						}
					}
				}
				else {
					// No row resolved; must be the select-all checkbox.
					this[this.allSelected ? 'clearSelection' : 'selectAll']();
				}

				this._selectionTriggerEvent = null;
			}
		},

		_changeSelectorInput: function (value, event) {
			if (this._selectorColumns.length) {
				this._updateRowSelectors(value, event);
			}
			if (this._hasSelectorHeaderCheckbox) {
				this._updateHeaderCheckboxes();
			}
		},

		_updateRowSelectors: function (value, event) {
			var rows = event.rows;
			var lenRows = rows.length;
			var lenCols = this._selectorColumns.length;

			for (var iRows = 0; iRows < lenRows; iRows++) {
				for (var iCols = 0; iCols < lenCols; iCols++) {
					var column = this._selectorColumns[iCols];
					var element = this.cell(rows[iRows], column.id).element;
					if (!element) {
						// Skip if row has been entirely removed
						continue;
					}
					element = (element.contents || element).input;
					if (element && !element.disabled) {
						// Only change the value if it is not disabled
						element.checked = value;
						element.setAttribute('aria-checked', value);
					}
				}
			}
		},

		_updateHeaderCheckboxes: function () {
			/* jshint eqeqeq: false */
			var lenCols = this._selectorColumns.length;
			for (var iCols = 0; iCols < lenCols; iCols++) {
				var column = this._selectorColumns[iCols];
				var state = 'false';
				var selection;
				var mixed;
				var selectorHeaderCheckbox = column._selectorHeaderCheckbox;
				if (selectorHeaderCheckbox) {
					selection = this.selection;
					mixed = false;
					// See if the header checkbox needs to be indeterminate
					for (var i in selection) {
						// If there is anything in the selection, than it is indeterminate
						// (Intentionally coerce since selection[i] can be undefined)
						if (selection[i] != this.allSelected) {
							mixed = true;
							break;
						}
					}
					selectorHeaderCheckbox.indeterminate = mixed;
					selectorHeaderCheckbox.checked = this.allSelected;
					if (mixed) {
						state = 'mixed';
					}
					else if (this.allSelected) {
						state = 'true';
					}
					selectorHeaderCheckbox.setAttribute('aria-checked', state);
				}
			}
		},

		configStructure: function () {
			this.inherited(arguments);
			var columns = this.columns;
			this._selectorColumns = [];
			this._hasSelectorHeaderCheckbox = this._selectorSingleRow = false;

			for (var k in columns) {
				if (columns[k].selector) {
					this._configureSelectorColumn(columns[k]);
				}
			}
		},

		_handleSelect: function (event) {
			// Ignore the default select handler for events that originate from the selector column
			var column = this.cell(event).column;
			if (!column || !column.selector) {
				this.inherited(arguments);
			}
		}
	});
});
},
'dgrid/OnDemandGrid':function(){
define([
	'dojo/_base/declare',
	'./Grid',
	'./OnDemandList'
], function (declare, Grid, OnDemandList) {
	return declare([ Grid, OnDemandList ], {});
});
},
'dgrid/OnDemandList':function(){
define([
	'./List',
	'./_StoreMixin',
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/on',
	'dojo/when',
	'./util/misc',
	'put-selector/put'
], function (List, _StoreMixin, declare, lang, on, when, miscUtil, put) {

	return declare([ List, _StoreMixin ], {
		// summary:
		//		Extends List to include virtual scrolling functionality, querying a
		//		dojo/store instance for the appropriate range when the user scrolls.

		// minRowsPerPage: Integer
		//		The minimum number of rows to request at one time.
		minRowsPerPage: 25,

		// maxRowsPerPage: Integer
		//		The maximum number of rows to request at one time.
		maxRowsPerPage: 250,

		// maxEmptySpace: Integer
		//		Defines the maximum size (in pixels) of unrendered space below the
		//		currently-rendered rows. Setting this to less than Infinity can be useful if you
		//		wish to limit the initial vertical scrolling of the grid so that the scrolling is
		// 		not excessively sensitive. With very large grids of data this may make scrolling
		//		easier to use, albiet it can limit the ability to instantly scroll to the end.
		maxEmptySpace: Infinity,

		// bufferRows: Integer
		//	  The number of rows to keep ready on each side of the viewport area so that the user can
		//	  perform local scrolling without seeing the grid being built. Increasing this number can
		//	  improve perceived performance when the data is being retrieved over a slow network.
		bufferRows: 10,

		// farOffRemoval: Integer
		//		Defines the minimum distance (in pixels) from the visible viewport area
		//		rows must be in order to be removed.  Setting to Infinity causes rows
		//		to never be removed.
		farOffRemoval: 2000,

		// queryRowsOverlap: Integer
		//		Indicates the number of rows to overlap queries. This helps keep
		//		continuous data when underlying data changes (and thus pages don't
		//		exactly align)
		queryRowsOverlap: 0,

		// pagingMethod: String
		//		Method (from dgrid/util/misc) to use to either throttle or debounce
		//		requests.  Default is "debounce" which will cause the grid to wait until
		//		the user pauses scrolling before firing any requests; can be set to
		//		"throttleDelayed" instead to progressively request as the user scrolls,
		//		which generally incurs more overhead but might appear more responsive.
		pagingMethod: 'debounce',

		// pagingDelay: Integer
		//		Indicates the delay (in milliseconds) imposed upon pagingMethod, to wait
		//		before paging in more data on scroll events. This can be increased to
		//		reduce client-side overhead or the number of requests sent to a server.
		pagingDelay: miscUtil.defaultDelay,

		// keepScrollPosition: Boolean
		//		When refreshing the list, controls whether the scroll position is
		//		preserved, or reset to the top.  This can also be overridden for
		//		specific calls to refresh.
		keepScrollPosition: false,

		rowHeight: 22,

		postCreate: function () {
			this.inherited(arguments);
			var self = this;
			// check visibility on scroll events
			on(this.bodyNode, 'scroll',
				miscUtil[this.pagingMethod](function (event) {
					self._processScroll(event);
				}, null, this.pagingDelay)
			);
		},

		renderQuery: function (query, options) {
			// summary:
			//		Creates a preload node for rendering a query into, and executes the query
			//		for the first page of data. Subsequent data will be downloaded as it comes
			//		into view.
			// query: Function
			//		Function to be called when requesting new data.
			// options: Object?
			//		Optional object containing the following:
			//		* container: Container to build preload nodes within; defaults to this.contentNode

			var self = this,
				container = (options && options.container) || this.contentNode,
				preload = {
					query: query,
					count: 0
				},
				preloadNode,
				priorPreload = this.preload;

			// Initial query; set up top and bottom preload nodes
			var topPreload = {
				node: put(container, 'div.dgrid-preload', {
					rowIndex: 0
				}),
				count: 0,
				query: query,
				next: preload
			};
			topPreload.node.style.height = '0';
			preload.node = preloadNode = put(container, 'div.dgrid-preload');
			preload.previous = topPreload;

			// this preload node is used to represent the area of the grid that hasn't been
			// downloaded yet
			preloadNode.rowIndex = this.minRowsPerPage;

			if (priorPreload) {
				// the preload nodes (if there are multiple) are represented as a linked list, need to insert it
				if ((preload.next = priorPreload.next) &&
						// is this preload node below the prior preload node?
						preloadNode.offsetTop >= priorPreload.node.offsetTop) {
					// the prior preload is above/before in the linked list
					preload.previous = priorPreload;
				}
				else {
					// the prior preload is below/after in the linked list
					preload.next = priorPreload;
					preload.previous = priorPreload.previous;
				}
				// adjust the previous and next links so the linked list is proper
				preload.previous.next = preload;
				preload.next.previous = preload;
			}
			else {
				this.preload = preload;
			}

			var loadingNode = put(preloadNode, '-div.dgrid-loading'),
				innerNode = put(loadingNode, 'div.dgrid-below');
			innerNode.innerHTML = this.loadingMessage;

			// Establish query options, mixing in our own.
			options = lang.mixin({ start: 0, count: this.minRowsPerPage },
				'level' in query ? { queryLevel: query.level } : null);

			// Protect the query within a _trackError call, but return the resulting collection
			return this._trackError(function () {
				var results = query(options);

				// Render the result set
				return self.renderQueryResults(results, preloadNode, options).then(function (trs) {
					return when(results.totalLength, function (total) {
						var trCount = trs.length,
							parentNode = preloadNode.parentNode,
							noDataNode = self.noDataNode;

						if (self._rows) {
							self._rows.min = 0;
							self._rows.max = trCount === total ? Infinity : trCount - 1;
						}

						put(loadingNode, '!');
						if (!('queryLevel' in options)) {
							self._total = total;
						}
						// now we need to adjust the height and total count based on the first result set
						if (total === 0) {
							if (noDataNode) {
								put(noDataNode, '!');
								delete self.noDataNode;
							}
							self.noDataNode = noDataNode = put('div.dgrid-no-data');
							parentNode.insertBefore(noDataNode, self._getFirstRowSibling(parentNode));
							noDataNode.innerHTML = self.noDataMessage;
						}
						var height = 0;
						for (var i = 0; i < trCount; i++) {
							height += self._calcRowHeight(trs[i]);
						}
						// only update rowHeight if we actually got results and are visible
						if (trCount && height) {
							self.rowHeight = height / trCount;
						}

						total -= trCount;
						preload.count = total;
						preloadNode.rowIndex = trCount;
						if (total) {
							preloadNode.style.height = Math.min(total * self.rowHeight, self.maxEmptySpace) + 'px';
						}
						else {
							preloadNode.style.display = 'none';
						}

						if (self._previousScrollPosition) {
							// Restore position after a refresh operation w/ keepScrollPosition
							self.scrollTo(self._previousScrollPosition);
							delete self._previousScrollPosition;
						}

						// Redo scroll processing in case the query didn't fill the screen,
						// or in case scroll position was restored
						return when(self._processScroll()).then(function () {
							return trs;
						});
					});
				}).otherwise(function (err) {
					// remove the loadingNode and re-throw
					put(loadingNode, '!');
					throw err;
				});
			});
		},

		refresh: function (options) {
			// summary:
			//		Refreshes the contents of the grid.
			// options: Object?
			//		Optional object, supporting the following parameters:
			//		* keepScrollPosition: like the keepScrollPosition instance property;
			//			specifying it in the options here will override the instance
			//			property's value for this specific refresh call only.

			var self = this,
				keep = (options && options.keepScrollPosition);

			// Fall back to instance property if option is not defined
			if (typeof keep === 'undefined') {
				keep = this.keepScrollPosition;
			}

			// Store scroll position to be restored after new total is received
			if (keep) {
				this._previousScrollPosition = this.getScrollPosition();
			}

			this.inherited(arguments);
			if (this._renderedCollection) {
				// render the query

				// renderQuery calls _trackError internally
				return this.renderQuery(function (queryOptions) {
					return self._renderedCollection.fetchRange({
						start: queryOptions.start,
						end: queryOptions.start + queryOptions.count
					});
				}).then(function () {
					// Emit on a separate turn to enable event to be used consistently for
					// initial render, regardless of whether the backing store is async
					setTimeout(function () {
						on.emit(self.domNode, 'dgrid-refresh-complete', {
							bubbles: true,
							cancelable: false,
							grid: self
						});
					}, 0);
				});
			}
		},

		resize: function () {
			this.inherited(arguments);
			this._processScroll();
		},

		cleanup: function () {
			this.inherited(arguments);
			this.preload = null;
		},

		renderQueryResults: function (results) {
			var rows = this.inherited(arguments);
			var collection = this._renderedCollection;

			if (collection && collection.releaseRange) {
				when(rows, function (resolvedRows) {
					if (resolvedRows[0] && !resolvedRows[0].parentNode.tagName) {
						// Release this range, since it was never actually rendered;
						// need to wait until totalLength promise resolves, since
						// Trackable only adds the range then to begin with
						when(results.totalLength, function () {
							collection.releaseRange(resolvedRows[0].rowIndex,
								resolvedRows[resolvedRows.length - 1].rowIndex + 1);
						});
					}
				});
			}

			return rows;
		},

		_getFirstRowSibling: function (container) {
			// summary:
			//		Returns the DOM node that a new row should be inserted before
			//		when there are no other rows in the current result set.
			//		In the case of OnDemandList, this will always be the last child
			//		of the container (which will be a trailing preload node).
			return container.lastChild;
		},

		_calcRowHeight: function (rowElement) {
			// summary:
			//		Calculate the height of a row. This is a method so it can be overriden for
			//		plugins that add connected elements to a row, like the tree

			var sibling = rowElement.nextSibling;

			// If a next row exists, compare the top of this row with the
			// next one (in case "rows" are actually rendering side-by-side).
			// If no next row exists, this is either the last or only row,
			// in which case we count its own height.
			if (sibling && !/\bdgrid-preload\b/.test(sibling.className)) {
				return sibling.offsetTop - rowElement.offsetTop;
			}

			return rowElement.offsetHeight;
		},

		lastScrollTop: 0,
		_processScroll: function (evt) {
			// summary:
			//		Checks to make sure that everything in the viewable area has been
			//		downloaded, and triggering a request for the necessary data when needed.
			var grid = this,
				scrollNode = grid.bodyNode,
				// grab current visible top from event if provided, otherwise from node
				visibleTop = (evt && evt.scrollTop) || this.getScrollPosition().y,
				visibleBottom = scrollNode.offsetHeight + visibleTop,
				priorPreload, preloadNode, preload = grid.preload,
				lastScrollTop = grid.lastScrollTop,
				requestBuffer = grid.bufferRows * grid.rowHeight,
				searchBuffer = requestBuffer - grid.rowHeight, // Avoid rounding causing multiple queries
				// References related to emitting dgrid-refresh-complete if applicable
				lastRows,
				preloadSearchNext = true;

			// XXX: I do not know why this happens.
			// munging the actual location of the viewport relative to the preload node by a few pixels in either
			// direction is necessary because at least WebKit on Windows seems to have an error that causes it to
			// not quite get the entire element being focused in the viewport during keyboard navigation,
			// which means it becomes impossible to load more data using keyboard navigation because there is
			// no more data to scroll to to trigger the fetch.
			// 1 is arbitrary and just gets it to work correctly with our current test cases; don’t wanna go
			// crazy and set it to a big number without understanding more about what is going on.
			// wondering if it has to do with border-box or something, but changing the border widths does not
			// seem to make it break more or less, so I do not know…
			var mungeAmount = 1;

			grid.lastScrollTop = visibleTop;

			function removeDistantNodes(preload, distanceOff, traversal, below) {
				// we check to see the the nodes are "far off"
				var farOffRemoval = grid.farOffRemoval,
					preloadNode = preload.node;
				// by checking to see if it is the farOffRemoval distance away
				if (distanceOff > 2 * farOffRemoval) {
					// there is a preloadNode that is far off;
					// remove rows until we get to in the current viewport
					var row;
					var nextRow = preloadNode[traversal];
					var reclaimedHeight = 0;
					var count = 0;
					var toDelete = [];
					var firstRowIndex = nextRow && nextRow.rowIndex;
					var lastRowIndex;

					while ((row = nextRow)) {
						var rowHeight = grid._calcRowHeight(row);
						if (reclaimedHeight + rowHeight + farOffRemoval > distanceOff ||
								(nextRow.className.indexOf('dgrid-row') < 0 &&
									nextRow.className.indexOf('dgrid-loading') < 0)) {
							// we have reclaimed enough rows or we have gone beyond grid rows
							break;
						}

						nextRow = row[traversal];
						reclaimedHeight += rowHeight;
						count += row.count || 1;
						// Just do cleanup here, as we will do a more efficient node destruction in a setTimeout below
						grid.removeRow(row, true);
						toDelete.push(row);

						if ('rowIndex' in row) {
							lastRowIndex = row.rowIndex;
						}
					}

					if (grid._renderedCollection.releaseRange &&
							typeof firstRowIndex === 'number' && typeof lastRowIndex === 'number') {
						// Note that currently child rows in Tree structures are never unrendered;
						// this logic will need to be revisited when that is addressed.

						// releaseRange is end-exclusive, and won't remove anything if start >= end.
						if (below) {
							grid._renderedCollection.releaseRange(lastRowIndex, firstRowIndex + 1);
						}
						else {
							grid._renderedCollection.releaseRange(firstRowIndex, lastRowIndex + 1);
						}

						grid._rows[below ? 'max' : 'min'] = lastRowIndex;
						if (grid._rows.max >= grid._total - 1) {
							grid._rows.max = Infinity;
						}
					}
					// now adjust the preloadNode based on the reclaimed space
					preload.count += count;
					if (below) {
						preloadNode.rowIndex -= count;
						adjustHeight(preload);
					}
					else {
						// if it is above, we can calculate the change in exact row changes,
						// which we must do to not mess with the scroll position
						preloadNode.style.height = (preloadNode.offsetHeight + reclaimedHeight) + 'px';
					}
					// we remove the elements after expanding the preload node so that
					// the contraction doesn't alter the scroll position
					var trashBin = put('div', toDelete);
					setTimeout(function () {
						// we can defer the destruction until later
						put(trashBin, '!');
					}, 1);
				}
			}

			function adjustHeight(preload, noMax) {
				preload.node.style.height = Math.min(preload.count * grid.rowHeight,
					noMax ? Infinity : grid.maxEmptySpace) + 'px';
			}
			function traversePreload(preload, moveNext) {
				// Skip past preloads that are not currently connected
				do {
					preload = moveNext ? preload.next : preload.previous;
				} while (preload && !preload.node.offsetWidth);
				return preload;
			}
			while (preload && !preload.node.offsetWidth) {
				// skip past preloads that are not currently connected
				preload = preload.previous;
			}
			// there can be multiple preloadNodes (if they split, or multiple queries are created),
			//	so we can traverse them until we find whatever is in the current viewport, making
			//	sure we don't backtrack
			while (preload && preload !== priorPreload) {
				priorPreload = grid.preload;
				grid.preload = preload;
				preloadNode = preload.node;
				var preloadTop = preloadNode.offsetTop;
				var preloadHeight;

				if (visibleBottom + mungeAmount + searchBuffer < preloadTop) {
					// the preload is below the line of sight
					preload = traversePreload(preload, (preloadSearchNext = false));
				}
				else if (visibleTop - mungeAmount - searchBuffer >
						(preloadTop + (preloadHeight = preloadNode.offsetHeight))) {
					// the preload is above the line of sight
					preload = traversePreload(preload, (preloadSearchNext = true));
				}
				else {
					// the preload node is visible, or close to visible, better show it
					var offset = ((preloadNode.rowIndex ? visibleTop - requestBuffer :
						visibleBottom) - preloadTop) / grid.rowHeight;
					var count = (visibleBottom - visibleTop + 2 * requestBuffer) / grid.rowHeight;
					// utilize momentum for predictions
					var momentum = Math.max(
						Math.min((visibleTop - lastScrollTop) * grid.rowHeight, grid.maxRowsPerPage / 2),
						grid.maxRowsPerPage / -2);
					count += Math.min(Math.abs(momentum), 10);
					if (preloadNode.rowIndex === 0) {
						// at the top, adjust from bottom to top
						offset -= count;
					}
					offset = Math.max(offset, 0);
					if (offset < 10 && offset > 0 && count + offset < grid.maxRowsPerPage) {
						// connect to the top of the preloadNode if possible to avoid excessive adjustments
						count += Math.max(0, offset);
						offset = 0;
					}
					count = Math.min(Math.max(count, grid.minRowsPerPage),
										grid.maxRowsPerPage, preload.count);

					if (count === 0) {
						preload = traversePreload(preload, preloadSearchNext);
						continue;
					}

					count = Math.ceil(count);
					offset = Math.min(Math.floor(offset), preload.count - count);

					var options = {};
					preload.count -= count;
					var beforeNode = preloadNode,
						keepScrollTo, queryRowsOverlap = grid.queryRowsOverlap,
						below = (preloadNode.rowIndex > 0 || preloadNode.offsetTop > visibleTop) && preload;
					if (below) {
						// add new rows below
						var previous = preload.previous;
						if (previous) {
							removeDistantNodes(previous,
								visibleTop - (previous.node.offsetTop + previous.node.offsetHeight),
								'nextSibling');
							if (offset > 0 && previous.node === preloadNode.previousSibling) {
								// all of the nodes above were removed
								offset = Math.min(preload.count, offset);
								preload.previous.count += offset;
								adjustHeight(preload.previous, true);
								preloadNode.rowIndex += offset;
								queryRowsOverlap = 0;
							}
							else {
								count += offset;
							}
							preload.count -= offset;
						}
						options.start = preloadNode.rowIndex - queryRowsOverlap;
						options.count = Math.min(count + queryRowsOverlap, grid.maxRowsPerPage);
						preloadNode.rowIndex = options.start + options.count;
					}
					else {
						// add new rows above
						if (preload.next) {
							// remove out of sight nodes first
							removeDistantNodes(preload.next, preload.next.node.offsetTop - visibleBottom,
								'previousSibling', true);
							beforeNode = preloadNode.nextSibling;
							if (beforeNode === preload.next.node) {
								// all of the nodes were removed, can position wherever we want
								preload.next.count += preload.count - offset;
								preload.next.node.rowIndex = offset + count;
								adjustHeight(preload.next);
								preload.count = offset;
								queryRowsOverlap = 0;
							}
							else {
								keepScrollTo = true;
							}

						}
						options.start = preload.count;
						options.count = Math.min(count + queryRowsOverlap, grid.maxRowsPerPage);
					}
					if (keepScrollTo && beforeNode && beforeNode.offsetWidth) {
						keepScrollTo = beforeNode.offsetTop;
					}

					adjustHeight(preload);

					// use the query associated with the preload node to get the next "page"
					if ('level' in preload.query) {
						options.queryLevel = preload.query.level;
					}

					// Avoid spurious queries (ideally this should be unnecessary...)
					if (!('queryLevel' in options) && (options.start > grid._total || options.count < 0)) {
						continue;
					}

					// create a loading node as a placeholder while the data is loaded
					var loadingNode = put(beforeNode,
						'-div.dgrid-loading[style=height:' + count * grid.rowHeight + 'px]');
					var innerNode = put(loadingNode, 'div.dgrid-' + (below ? 'below' : 'above'));
					innerNode.innerHTML = grid.loadingMessage;
					loadingNode.count = count;

					// Query now to fill in these rows.
					grid._trackError(function () {
						// Use function to isolate the variables in case we make multiple requests
						// (which can happen if we need to render on both sides of an island of already-rendered rows)
						(function (loadingNode, below, keepScrollTo) {
							/* jshint maxlen: 122 */
							var rangeResults = preload.query(options);
							lastRows = grid.renderQueryResults(rangeResults, loadingNode, options).then(function (rows) {
								var gridRows = grid._rows;
								if (gridRows && !('queryLevel' in options) && rows.length) {
									// Update relevant observed range for top-level items
									if (below) {
										if (gridRows.max <= gridRows.min) {
											// All rows were removed; update start of rendered range as well
											gridRows.min = rows[0].rowIndex;
										}
										gridRows.max = rows[rows.length - 1].rowIndex;
									}
									else {
										if (gridRows.max <= gridRows.min) {
											// All rows were removed; update end of rendered range as well
											gridRows.max = rows[rows.length - 1].rowIndex;
										}
										gridRows.min = rows[0].rowIndex;
									}
								}

								// can remove the loading node now
								beforeNode = loadingNode.nextSibling;
								put(loadingNode, '!');
								// beforeNode may have been removed if the query results loading node was removed
								// as a distant node before rendering
								if (keepScrollTo && beforeNode && beforeNode.offsetWidth) {
									// if the preload area above the nodes is approximated based on average
									// row height, we may need to adjust the scroll once they are filled in
									// so we don't "jump" in the scrolling position
									var pos = grid.getScrollPosition();
									grid.scrollTo({
										// Since we already had to query the scroll position,
										// include x to avoid TouchScroll querying it again on its end.
										x: pos.x,
										y: pos.y + beforeNode.offsetTop - keepScrollTo,
										// Don't kill momentum mid-scroll (for TouchScroll only).
										preserveMomentum: true
									});
								}

								when(rangeResults.totalLength, function (total) {
									if (!('queryLevel' in options)) {
										grid._total = total;
										if (grid._rows && grid._rows.max >= grid._total - 1) {
											grid._rows.max = Infinity;
										}
									}
									if (below) {
										// if it is below, we will use the total from the collection to update
										// the count of the last preload in case the total changes as
										// later pages are retrieved

										// recalculate the count
										below.count = total - below.node.rowIndex;
										// readjust the height
										adjustHeight(below);
									}
								});

								// make sure we have covered the visible area
								grid._processScroll();
								return rows;
							}, function (e) {
								put(loadingNode, '!');
								throw e;
							});
						})(loadingNode, below, keepScrollTo);
					});

					preload = preload.previous;

				}
			}

			// return the promise from the last render
			return lastRows;
		}
	});

});

},
'dgrid/_StoreMixin':function(){
define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/Deferred',
	'dojo/aspect',
	'dojo/on',
	'dojo/when',
	'put-selector/put'
], function (declare, lang, Deferred, aspect, on, when, put) {
	// This module isolates the base logic required by store-aware list/grid
	// components, e.g. OnDemandList/Grid and the Pagination extension.

	function emitError(err) {
		// called by _trackError in context of list/grid, if an error is encountered
		if (typeof err !== 'object') {
			// Ensure we actually have an error object, so we can attach a reference.
			err = new Error(err);
		}
		else if (err.dojoType === 'cancel') {
			// Don't fire dgrid-error events for errors due to canceled requests
			// (unfortunately, the Deferred instrumentation will still log them)
			return;
		}

		var event = on.emit(this.domNode, 'dgrid-error', {
			grid: this,
			error: err,
			cancelable: true,
			bubbles: true
		});
		if (event) {
			console.error(err);
		}
	}

	return declare(null, {
		// collection: Object
		//		The base object collection (implementing the dstore/api/Store API) before being sorted
		//		or otherwise processed by the grid. Use it for general purpose store operations such as
		//		`getIdentity` and `get`, `add`, `put`, and `remove`.
		collection: null,

		// _renderedCollection: Object
		//		The object collection from which data is to be fetched. This is the sorted collection.
		//		Use it when retrieving data to be rendered by the grid.
		_renderedCollection: null,

		// _rows: Array
		//		Sparse array of row nodes, used to maintain the grid in response to events from a tracked collection.
		//		Each node's index corresponds to the index of its data object in the collection.
		_rows: null,

		// _observerHandle: Object
		//		The observer handle for the current collection, if trackable.
		_observerHandle: null,

		// shouldTrackCollection: Boolean
		//		Whether this instance should track any trackable collection it is passed.
		shouldTrackCollection: true,

		// getBeforePut: boolean
		//		If true, a get request will be performed to the store before each put
		//		as a baseline when saving; otherwise, existing row data will be used.
		getBeforePut: true,

		// noDataMessage: String
		//		Message to be displayed when no results exist for a collection, whether at
		//		the time of the initial query or upon subsequent observed changes.
		//		Defined by _StoreMixin, but to be implemented by subclasses.
		noDataMessage: '',

		// loadingMessage: String
		//		Message displayed when data is loading.
		//		Defined by _StoreMixin, but to be implemented by subclasses.
		loadingMessage: '',

		_total: 0,

		constructor: function () {
			// Create empty objects on each instance, not the prototype
			this.dirty = {};
			this._updating = {}; // Tracks rows that are mid-update
			this._columnsWithSet = {};

			// Reset _columnsWithSet whenever column configuration is reset
			aspect.before(this, 'configStructure', lang.hitch(this, function () {
				this._columnsWithSet = {};
			}));
		},

		destroy: function () {
			this.inherited(arguments);

			if (this._renderedCollection) {
				this._cleanupCollection();
			}
		},

		_configColumn: function (column) {
			// summary:
			//		Implements extension point provided by Grid to store references to
			//		any columns with `set` methods, for use during `save`.
			if (column.set) {
				this._columnsWithSet[column.field] = column;
			}
			this.inherited(arguments);
		},

		_setCollection: function (collection) {
			// summary:
			//		Assigns a new collection to the list/grid, sets up tracking
			//		if applicable, and tells the list/grid to refresh.

			if (this._renderedCollection) {
				this.cleanup();
				this._cleanupCollection({
					// Only clear the dirty hash if the collection being used is actually from a different store
					// (i.e. not just a re-sorted / re-filtered version of the same store)
					shouldRevert: !collection || collection.storage !== this._renderedCollection.storage
				});
			}

			if (collection) {
				var renderedCollection = collection;
				if (this.sort && this.sort.length > 0) {
					renderedCollection = collection.sort(this.sort);
				}

				if (renderedCollection.track && this.shouldTrackCollection) {
					renderedCollection = renderedCollection.track();
					this._rows = [];

					this._observerHandle = this._observeCollection(
						renderedCollection,
						this.contentNode,
						{ rows: this._rows }
					);
				}

				this._renderedCollection = renderedCollection;
			}

			this.collection = collection;
			this.refresh();
		},

		_setStore: function () {
			if (!this.collection) {
				console.debug('set(\'store\') call detected, but you probably meant set(\'collection\') for 0.4');
			}
		},

		_getTotal: function () {
			// summary:
			//		Retrieves the currently-tracked total (as updated by
			//		subclasses after store queries, or by _StoreMixin in response to
			//		updated totalLength in events)

			return this._total;
		},

		_cleanupCollection: function (options) {
			// summary:
			//		Handles cleanup duty for the previous collection;
			//		called during _setCollection and destroy.
			// options: Object?
			//		* shouldRevert: Whether to clear the dirty hash

			options = options || {};

			if (this._renderedCollection.tracking) {
				this._renderedCollection.tracking.remove();
			}

			// Remove observer and existing rows so any sub-row observers will be cleaned up
			if (this._observerHandle) {
				this._observerHandle.remove();
				this._observerHandle = this._rows = null;
			}

			// Discard dirty map, as it applied to a previous collection
			if (options.shouldRevert !== false) {
				this.dirty = {};
			}

			this._renderedCollection = this.collection = null;
		},

		_applySort: function () {
			if (this.collection) {
				this.set('collection', this.collection);
			}
			else if (this.store) {
				console.debug('_StoreMixin found store property but not collection; ' +
					'this is often the sign of a mistake during migration from 0.3 to 0.4');
			}
		},

		row: function () {
			// Extend List#row with more appropriate lookup-by-id logic
			var row = this.inherited(arguments);
			if (row && row.data && typeof row.id !== 'undefined') {
				row.id = this.collection.getIdentity(row.data);
			}
			return row;
		},

		refresh: function () {
			var result = this.inherited(arguments);

			if (!this.collection) {
				this.noDataNode = put(this.contentNode, 'div.dgrid-no-data');
				this.noDataNode.innerHTML = this.noDataMessage;
			}

			return result;
		},

		renderArray: function () {
			var rows = this.inherited(arguments);

			if (!this.collection) {
				if (rows.length && this.noDataNode) {
					put(this.noDataNode, '!');
				}
			}
			return rows;
		},

		insertRow: function (object, parent, beforeNode, i, options) {
			var store = this.collection,
				dirty = this.dirty,
				id = store && store.getIdentity(object),
				dirtyObj,
				row;

			if (id in dirty && !(id in this._updating)) {
				dirtyObj = dirty[id];
			}
			if (dirtyObj) {
				// restore dirty object as delegate on top of original object,
				// to provide protection for subsequent changes as well
				object = lang.delegate(object, dirtyObj);
			}

			row = this.inherited(arguments);

			if (options && options.rows) {
				options.rows[i] = row;
			}

			// Remove no data message when a new row appears.
			// Run after inherited logic to prevent confusion due to noDataNode
			// no longer being present as a sibling.
			if (this.noDataNode) {
				put(this.noDataNode, '!');
				this.noDataNode = null;
			}

			return row;
		},

		updateDirty: function (id, field, value) {
			// summary:
			//		Updates dirty data of a field for the item with the specified ID.
			var dirty = this.dirty,
				dirtyObj = dirty[id];

			if (!dirtyObj) {
				dirtyObj = dirty[id] = {};
			}
			dirtyObj[field] = value;
		},

		save: function () {
			// Keep track of the store and puts
			var self = this,
				store = this.collection,
				dirty = this.dirty,
				dfd = new Deferred(), promise = dfd.promise,
				getFunc = function (id) {
					// returns a function to pass as a step in the promise chain,
					// with the id variable closured
					var data;
					return (self.getBeforePut || !(data = self.row(id).data)) ?
						function () {
							return store.get(id);
						} :
						function () {
							return data;
						};
				};

			// function called within loop to generate a function for putting an item
			function putter(id, dirtyObj) {
				// Return a function handler
				return function (object) {
					var colsWithSet = self._columnsWithSet,
						updating = self._updating,
						key, data;

					if (typeof object.set === 'function') {
						object.set(dirtyObj);
					} else {
						// Copy dirty props to the original, applying setters if applicable
						for (key in dirtyObj) {
							object[key] = dirtyObj[key];
						}
					}

					// Apply any set methods in column definitions.
					// Note that while in the most common cases column.set is intended
					// to return transformed data for the key in question, it is also
					// possible to directly modify the object to be saved.
					for (key in colsWithSet) {
						data = colsWithSet[key].set(object);
						if (data !== undefined) {
							object[key] = data;
						}
					}

					updating[id] = true;
					// Put it in the store, returning the result/promise
					return when(store.put(object), function () {
						// Clear the item now that it's been confirmed updated
						delete dirty[id];
						delete updating[id];
					});
				};
			}

			// For every dirty item, grab the ID
			for (var id in dirty) {
				// Create put function to handle the saving of the the item
				var put = putter(id, dirty[id]);

				// Add this item onto the promise chain,
				// getting the item from the store first if desired.
				promise = promise.then(getFunc(id)).then(put);
			}

			// Kick off and return the promise representing all applicable get/put ops.
			// If the success callback is fired, all operations succeeded; otherwise,
			// save will stop at the first error it encounters.
			dfd.resolve();
			return promise;
		},

		revert: function () {
			// summary:
			//		Reverts any changes since the previous save.
			this.dirty = {};
			this.refresh();
		},

		_trackError: function (func) {
			// summary:
			//		Utility function to handle emitting of error events.
			// func: Function|String
			//		A function which performs some store operation, or a String identifying
			//		a function to be invoked (sans arguments) hitched against the instance.
			//		If sync, it can return a value, but may throw an error on failure.
			//		If async, it should return a promise, which would fire the error
			//		callback on failure.
			// tags:
			//		protected

			if (typeof func === 'string') {
				func = lang.hitch(this, func);
			}

			var self = this,
				promise;

			try {
				promise = when(func());
			} catch (err) {
				// report sync error
				var dfd = new Deferred();
				dfd.reject(err);
				promise = dfd.promise;
			}

			promise.otherwise(function (err) {
				emitError.call(self, err);
			});
			return promise;
		},

		removeRow: function (rowElement, preserveDom, options) {
			var row = {element: rowElement};
			// Check to see if we are now empty...
			if (!preserveDom && this.noDataMessage &&
					(this.up(row).element === rowElement) &&
					(this.down(row).element === rowElement)) {
				// ...we are empty, so show the no data message.
				this.noDataNode = put(this.contentNode, 'div.dgrid-no-data');
				this.noDataNode.innerHTML = this.noDataMessage;
			}

			var rows = (options && options.rows) || this._rows;
			if (rows) {
				delete rows[rowElement.rowIndex];
			}

			return this.inherited(arguments);
		},

		renderQueryResults: function (results, beforeNode, options) {
			// summary:
			//		Renders objects from QueryResults as rows, before the given node.

			options = lang.mixin({ rows: this._rows }, options);
			var self = this;

			return when(results).then(function (resolvedResults) {
				var resolvedRows = self.renderArray(resolvedResults, beforeNode, options);
				delete self._lastCollection; // used only for non-store List/Grid
				return resolvedRows;
			});
		},

		_observeCollection: function (collection, container, options) {
			var self = this,
				rows = options.rows,
				row;

			var handles = [
				collection.on('delete, update', function (event) {
					var from = event.previousIndex;
					var to = event.index;

					if (from !== undefined && rows[from]) {
						if ('max' in rows && (to === undefined || to < rows.min || to > rows.max)) {
							rows.max--;
						}

						row = rows[from];

						// check to make the sure the node is still there before we try to remove it
						// (in case it was moved to a different place in the DOM)
						if (row.parentNode === container) {
							self.removeRow(row, false, options);
						}

						// remove the old slot
						rows.splice(from, 1);

						if (event.type === 'delete' ||
								(event.type === 'update' && (from < to || to === undefined))) {
							// adjust the rowIndex so adjustRowIndices has the right starting point
							rows[from] && rows[from].rowIndex--;
						}

						// the removal of rows could cause us to need to page in more items
						if (self._processScroll) {
							self._processScroll();
						}
					}
					if (event.type === 'delete') {
						// Reset row in case this is later followed by an add;
						// only update events should retain the row variable below
						row = null;
					}
				}),

				collection.on('add, update', function (event) {
					var from = event.previousIndex;
					var to = event.index;
					var nextNode;

					function advanceNext() {
						nextNode = (nextNode.connected || nextNode).nextSibling;
					}

					// When possible, restrict observations to the actually rendered range
					if (to !== undefined && (!('max' in rows) || (to >= rows.min && to <= rows.max))) {
						if ('max' in rows && (from === undefined || from < rows.min || from > rows.max)) {
							rows.max++;
						}
						// Add to new slot (either before an existing row, or at the end)
						// First determine the DOM node that this should be placed before.
						if (rows.length) {
							nextNode = rows[to];
							if (!nextNode) {
								nextNode = rows[to - 1];
								if (nextNode) {
									// Make sure to skip connected nodes, so we don't accidentally
									// insert a row in between a parent and its children.
									advanceNext();
								}
							}
						}
						else {
							// There are no rows.  Allow for subclasses to insert new rows somewhere other than
							// at the end of the parent node.
							nextNode = self._getFirstRowSibling && self._getFirstRowSibling(container);
						}
						// Make sure we don't trip over a stale reference to a
						// node that was removed, or try to place a node before
						// itself (due to overlapped queries)
						if (row && nextNode && row.id === nextNode.id) {
							advanceNext();
						}
						if (nextNode && !nextNode.parentNode) {
							nextNode = document.getElementById(nextNode.id);
						}
						rows.splice(to, 0, undefined);
						row = self.insertRow(event.target, container, nextNode, to, options);
						self.highlightRow(row);
					}
					// Reset row so it doesn't get reused on the next event
					row = null;
				}),

				collection.on('add, delete, update', function (event) {
					var from = (typeof event.previousIndex !== 'undefined') ? event.previousIndex : Infinity,
						to = (typeof event.index !== 'undefined') ? event.index : Infinity,
						adjustAtIndex = Math.min(from, to);
					from !== to && rows[adjustAtIndex] && self.adjustRowIndices(rows[adjustAtIndex]);

					// Fire _onNotification, even for out-of-viewport notifications,
					// since some things may still need to update (e.g. Pagination's status/navigation)
					self._onNotification(rows, event, collection);

					// Update _total after _onNotification so that it can potentially
					// decide whether to perform actions based on whether the total changed
					if (collection === self._renderedCollection && 'totalLength' in event) {
						self._total = event.totalLength;
					}
				})
			];

			return {
				remove: function () {
					while (handles.length > 0) {
						handles.pop().remove();
					}
				}
			};
		},

		_onNotification: function () {
			// summary:
			//		Protected method called whenever a store notification is observed.
			//		Intended to be extended as necessary by mixins/extensions.
			// rows: Array
			//		A sparse array of row nodes corresponding to data objects in the collection.
			// event: Object
			//		The notification event
			// collection: Object
			//		The collection that the notification is relevant to.
			//		Useful for distinguishing child-level from top-level notifications.
		}
	});
});

},
'dstore/Tree':function(){
define([
	'dojo/_base/declare'
	/*=====, 'dstore/Store'=====*/
], function (declare /*=====, Store=====*/) {
	return declare(null, {
		constructor: function () {
			this.root = this;
		},

		mayHaveChildren: function (object) {
			// summary:
			//		Check if an object may have children
			// description:
			//		This method is useful for eliminating the possibility that an object may have children,
			//		allowing collection consumers to determine things like whether to render UI for child-expansion
			//		and whether a query is necessary to retrieve an object's children.
			// object:
			//		The potential parent
			// returns: boolean

			return 'hasChildren' in object ? object.hasChildren : true;
		},

		getRootCollection: function () {
			// summary:
			//		Get the collection of objects with no parents
			// returns: dstore/Store.Collection

			return this.root.filter({ parent: null });
		},

		getChildren: function (object) {
			// summary:
			//		Get a collection of the children of the provided parent object
			// object:
			//		The parent object
			// returns: dstore/Store.Collection

			return this.root.filter({ parent: this.getIdentity(object) });
		}
	});
});

},
'dstore/Trackable':function(){
define([
	'dojo/_base/lang',
	'dojo/_base/declare',
	'dojo/aspect',
	'dojo/when',
	'dojo/promise/all',
	'dojo/_base/array',
	'dojo/on',
	'./QueryResults'
	/*=====, './api/Store' =====*/
], function (lang, declare, aspect, when, whenAll, arrayUtil, on, QueryResults /*=====, Store =====*/) {

	// module:
	//		dstore/Trackable
	var revision = 0;

	function createRange(newStart, newEnd) {
		return {
			start: newStart,
			count: newEnd - newStart
		};
	}

	function registerRange(ranges, newStart, newEnd) {
		for (var i = ranges.length - 1; i >= 0; --i) {
			var existingRange = ranges[i],
				existingStart = existingRange.start,
				existingEnd = existingStart + existingRange.count;

			if (newStart > existingEnd) {
				// existing range completely precedes new range. we are done.
				ranges.splice(i + 1, 0, createRange(newStart, newEnd));
				return;
			} else if (newEnd >= existingStart) {
				// the ranges overlap and must be merged into a single range
				newStart = Math.min(newStart, existingStart);
				newEnd = Math.max(newEnd, existingEnd);
				ranges.splice(i, 1);
			}
		}

		ranges.unshift(createRange(newStart, newEnd));
	}

	function unregisterRange(ranges, start, end) {
		for (var i = 0, range; (range = ranges[i]); ++i) {
			var existingStart = range.start,
				existingEnd = existingStart + range.count;

			if (start <= existingStart) {
				if (end >= existingEnd) {
					// The existing range is within the forgotten range
					ranges.splice(i, 1);
				} else {
					// The forgotten range overlaps the beginning of the existing range
					range.start = end;
					range.count = existingEnd - range.start;

					// Since the forgotten range ends before the existing range,
					// there are no more ranges to update, and we are done
					return;
				}
			} else if (start < existingEnd) {
				if (end > existingStart) {
					// The forgotten range is within the existing range
					ranges.splice(i, 1, createRange(existingStart, start), createRange(end, existingEnd));

					// We are done because the existing range bounded the forgotten range
					return;
				} else {
					// The forgotten range overlaps the end of the existing range
					range.count = start - range.start;
				}
			}
		}
	}

	var trackablePrototype = {
		track: function () {
			var store = this.store || this;

			// monitor for updates by listening to these methods
			var handles = [];
			var eventTypes = {add: 1, update: 1, 'delete': 1};
			// register to listen for updates
			for (var type in eventTypes) {
				handles.push(
					this.on(type, (function (type) {
						return function (event) {
							notify(type, event);
						};
					})(type))
				);
			}

			function makeFetch() {
				return function () {
					var self = this;
					var fetchResults = this.inherited(arguments);
					return new QueryResults(when(fetchResults, function (results) {
						results = self._results = results.slice();

						self._ranges = [];
						registerRange(self._ranges, 0, results.length);

						return results;
					}), {
						totalLength: fetchResults.totalLength
					});
				};
			}
			function makeFetchRange() {
				return function (kwArgs) {
					var self = this,
						start = kwArgs.start,
						end = kwArgs.end,
						fetchResults = this.inherited(arguments);
					when(fetchResults, function (results) {
						return when(results.totalLength, function (totalLength) {
							var partialResults = self._partialResults || (self._partialResults = []);
							end = Math.min(end, start + results.length);

							partialResults.length = totalLength;

							// copy the new ranged data into the parent partial data set
							var spliceArgs = [ start, end - start ].concat(results);
							partialResults.splice.apply(partialResults, spliceArgs);
							registerRange(self._ranges, start, end);

							return results;
						});
					});
					return fetchResults;
				};
			}

			// delegate rather than call _createSubCollection because we are not ultimately creating
			// a new collection, just decorating an existing collection with item index tracking.
			// If we use _createSubCollection, it will return a new collection that may exclude
			// important, defining properties from the tracked collection.
			var observed = declare.safeMixin(lang.delegate(this), {
				_ranges: [],

				fetch: makeFetch(),
				fetchRange: makeFetchRange(),

				releaseRange: function (start, end) {
					if (this._partialResults) {
						unregisterRange(this._ranges, start, end);

						for (var i = start; i < end; ++i) {
							delete this._partialResults[i];
						}
					}
				},

				on: function (type, listener) {
					var self = this,
						inheritedOn = this.getInherited(arguments);
					return on.parse(observed, type, listener, function (target, type) {
						return type in eventTypes ?
							aspect.after(observed, 'on_tracked' + type, listener, true) :
							inheritedOn.call(self, type, listener);
					});
				},

				tracking: {
					remove: function () {
						while (handles.length > 0) {
							handles.pop().remove();
						}

						this.remove = function () {};
					}
				},
				// make sure track isn't called twice
				track: null
			});
			if (this.fetchSync) {
				// only add these if we extending a sync-capable store
				declare.safeMixin(observed, {
					fetchSync: makeFetch(),
					fetchRangeSync: makeFetchRange()
				});
			}

			// Create a function that applies all queriers in the query log
			// in order to determine whether a new or updated item belongs
			// in the results and at what position.
			var queryExecutor;
			arrayUtil.forEach(this.queryLog, function (entry) {
				var existingQuerier = queryExecutor,
					querier = entry.querier;

				if (querier) {
					queryExecutor = existingQuerier
						? function (data) { return querier(existingQuerier(data)); }
						: querier;
				}
			});

			var defaultEventProps = {
					'add': { index: undefined },
					'update': { previousIndex: undefined, index: undefined },
					'delete': { previousIndex: undefined }
				},
				findObject = function (data, id, start, end) {
					start = start !== undefined ? start : 0;
					end = end !== undefined ? end : data.length;
					for (var i = start; i < end; ++i) {
						if (store.getIdentity(data[i]) === id) {
							return i;
						}
					}
					return -1;
				};
			function notify(type, event) {
				revision++;
				var target = event.target;
				event = lang.delegate(event, defaultEventProps[type]);
				when(observed._results || observed._partialResults, function (resultsArray) {
					/* jshint maxcomplexity: 30 */

					function emitEvent() {
						// TODO: Eventually we will want to aggregate all the listener events
						// in an event turn, but we will wait until we have a reliable, performant queueing
						// mechanism for this (besides setTimeout)
						var method = observed['on_tracked' + type];
						method && method.call(observed, event);
					}

					if (!resultsArray) {
						// without data, we have no way to determine the indices effected by the change,
						// so just pass along the event and return.
						emitEvent();
						return;
					}

					var i, j, l, ranges = observed._ranges, range;
					/*if(++queryRevision != revision){
						throw new Error('Query is out of date, you must observe() the' +
						' query prior to any data modifications');
					}*/

					var targetId = 'id' in event ? event.id : store.getIdentity(target);
					var removedFrom = -1,
						removalRangeIndex = -1,
						insertedInto = -1,
						insertionRangeIndex = -1;
					if (type === 'delete' || type === 'update') {
						// remove the old one
						for (i = 0; removedFrom === -1 && i < ranges.length; ++i) {
							range = ranges[i];
							for (j = range.start, l = j + range.count; j < l; ++j) {
								var object = resultsArray[j];
								// often ids can be converted strings (if they are used as keys in objects),
								// so we do a coercive equality check
								/* jshint eqeqeq: false */
								if (store.getIdentity(object) == targetId) {
									removedFrom = event.previousIndex = j;
									removalRangeIndex = i;
									resultsArray.splice(removedFrom, 1);

									range.count--;
									for (j = i + 1; j < ranges.length; ++j) {
										ranges[j].start--;
									}

									break;
								}
							}
						}
					}

					if (type === 'add' || type === 'update') {
						if (queryExecutor) {
							// with a queryExecutor, we can determine the correct sorted index for the change

							if (queryExecutor([target]).length) {
								var begin = 0,
									end = ranges.length - 1,
									sampleArray,
									candidateIndex = -1,
									sortedIndex,
									adjustedIndex;
								while (begin <= end && insertedInto === -1) {
									// doing a binary search for the containing range
									i = begin + Math.round((end - begin) / 2);
									range = ranges[i];

									sampleArray = resultsArray.slice(range.start, range.start + range.count);

									if ('beforeId' in event) {
										candidateIndex = event.beforeId === null
											? sampleArray.length
											: findObject(sampleArray, event.beforeId);
									}

									if (candidateIndex === -1) {
										// If the original index came from this range, put back in the original slot
										// so it doesn't move unless it needs to (relying on a stable sort below)
										if (removedFrom >= Math.max(0, range.start - 1)
											&& removedFrom <= (range.start + range.count)) {
											candidateIndex = removedFrom;
										} else {
											candidateIndex = store.defaultNewToStart ? 0 : sampleArray.length;
										}
									}
									sampleArray.splice(candidateIndex, 0, target);

									sortedIndex = arrayUtil.indexOf(queryExecutor(sampleArray), target);
									adjustedIndex = range.start + sortedIndex;

									if (sortedIndex === 0 && range.start !== 0) {
										end = i - 1;
									} else if (sortedIndex >= (sampleArray.length - 1) &&
											adjustedIndex < resultsArray.length) {
										begin = i + 1;
									} else {
										insertedInto = adjustedIndex;
										insertionRangeIndex = i;
									}
								}
							}
						} else {
							// we don't have a queryExecutor, so we can't provide any information
							// about where it was inserted or moved to. If it is an update, we leave
							// its position alone. otherwise, we at least indicate a new object

							var range,
								possibleRangeIndex = -1;
							if ('beforeId' in event) {
								if (event.beforeId === null) {
									insertedInto = resultsArray.length;
									possibleRangeIndex = ranges.length - 1;
								} else {
									for (i = 0, l = ranges.length; insertionRangeIndex === -1 && i < l; ++i) {
										range = ranges[i];

										insertedInto = findObject(
											resultsArray,
											event.beforeId,
											range.start,
											range.start + range.count
										);

										if (insertedInto !== -1) {
											insertionRangeIndex = i;
										}
									}
								}
							} else {
								if (type === 'update') {
									insertedInto = removedFrom;
									insertionRangeIndex = removalRangeIndex;
								} else {
									if (store.defaultNewToStart) {
										insertedInto = 0;
										possibleRangeIndex = 0;
									} else {
										// default to the bottom
										insertedInto = resultsArray.length;
										possibleRangeIndex = ranges.length - 1;
									}
								}
							}

							if (possibleRangeIndex !== -1 && insertionRangeIndex === -1) {
								range = ranges[possibleRangeIndex];
								if (range && range.start <= insertedInto
									&& insertedInto <= (range.start + range.count)) {
									insertionRangeIndex = possibleRangeIndex;
								}
							}
						}

						// an item only truly has a known index if it is in a known range
						if (insertedInto > -1 && insertionRangeIndex > -1) {
							event.index = insertedInto;
							resultsArray.splice(insertedInto, 0, target);

							// update the count and start of the appropriate ranges
							ranges[insertionRangeIndex].count++;
							for (i = insertionRangeIndex + 1; i < ranges.length; ++i) {
								ranges[i].start++;
							}
						}
					}
					// update the total
					event.totalLength = resultsArray.length;

					emitEvent();
				});
			}

			return observed;
		}
	};

	var Trackable =  declare(null, trackablePrototype);
	Trackable.create = function (target, properties) {
		// create a delegate of an existing store with trackability functionality mixed in
		target = declare.safeMixin(lang.delegate(target), trackablePrototype);
		declare.safeMixin(target, properties);
		return target;
	};
	return Trackable;
});

},
'dojo/promise/all':function(){
define([
	"../_base/array",
	"../Deferred",
	"../when"
], function(array, Deferred, when){
	"use strict";

	// module:
	//		dojo/promise/all

	var some = array.some;

	return function all(objectOrArray){
		// summary:
		//		Takes multiple promises and returns a new promise that is fulfilled
		//		when all promises have been resolved or one has been rejected.
		// description:
		//		Takes multiple promises and returns a new promise that is fulfilled
		//		when all promises have been resolved or one has been rejected. If one of
		//		the promises is rejected, the returned promise is also rejected. Canceling
		//		the returned promise will *not* cancel any passed promises.
		// objectOrArray: Object|Array?
		//		The promise will be fulfilled with a list of results if invoked with an
		//		array, or an object of results when passed an object (using the same
		//		keys). If passed neither an object or array it is resolved with an
		//		undefined value.
		// returns: dojo/promise/Promise

		var object, array;
		if(objectOrArray instanceof Array){
			array = objectOrArray;
		}else if(objectOrArray && typeof objectOrArray === "object"){
			object = objectOrArray;
		}

		var results;
		var keyLookup = [];
		if(object){
			array = [];
			for(var key in object){
				if(Object.hasOwnProperty.call(object, key)){
					keyLookup.push(key);
					array.push(object[key]);
				}
			}
			results = {};
		}else if(array){
			results = [];
		}

		if(!array || !array.length){
			return new Deferred().resolve(results);
		}

		var deferred = new Deferred();
		deferred.promise.always(function(){
			results = keyLookup = null;
		});
		var waiting = array.length;
		some(array, function(valueOrPromise, index){
			if(!object){
				keyLookup.push(index);
			}
			when(valueOrPromise, function(value){
				if(!deferred.isFulfilled()){
					results[keyLookup[index]] = value;
					if(--waiting === 0){
						deferred.resolve(results);
					}
				}
			}, deferred.reject);
			return deferred.isFulfilled();
		});
		return deferred.promise;	// dojo/promise/Promise
	};
});

},
'dstore/QueryResults':function(){
define(['dojo/_base/lang', 'dojo/when'], function (lang, when) {
	function forEach(callback, instance) {
		return when(this, function(data) {
			for (var i = 0, l = data.length; i < l; i++){
				callback.call(instance, data[i], i, data);
			}
		});
	}
	return function (data, options) {
		var hasTotalLength = options && 'totalLength' in options;
		if(data.then) {
			data = lang.delegate(data);
			// a promise for the eventual realization of the totalLength, in
			// case it comes from the resolved data
			var totalLengthPromise = data.then(function (data) {
				// calculate total length, now that we have access to the resolved data
				var totalLength = hasTotalLength ? options.totalLength :
						data.totalLength || data.length;
				// make it available on the resolved data
				data.totalLength = totalLength;
				return totalLength;
			});
			// make the totalLength available on the promise (whether through the options or the enventual
			// access to the resolved data)
			data.totalLength = hasTotalLength ? options.totalLength : totalLengthPromise;
			// make the response available as well
			data.response = options && options.response;
		} else {
			data.totalLength = hasTotalLength ? options.totalLength : data.length;
		}

		data.forEach = forEach;

		return data;
	};
});

},
'dstore/Memory':function(){
define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/_base/array',
	'./Store',
	'./Promised',
	'./SimpleQuery',
	'./QueryResults'
], function (declare, lang, arrayUtil, Store, Promised, SimpleQuery, QueryResults) {

	// module:
	//		dstore/Memory
	return declare([Store, Promised, SimpleQuery ], {
		constructor: function () {
			// summary:
			//		Creates a memory object store.
			// options: dstore/Memory
			//		This provides any configuration information that will be mixed into the store.
			//		This should generally include the data property to provide the starting set of data.

			// Add a version property so subcollections can detect when they're using stale data
			this.storage.version = 0;
		},

		postscript: function () {
			this.inherited(arguments);

			// Set the data in `postscript` so subclasses can override `data` in their constructors
			// (e.g., a LocalStorage store that retrieves its data from localStorage)
			this.setData(this.data || []);
		},

		// data: Array
		//		The array of all the objects in the memory store
		data: null,

		autoEmitEvents: false, // this is handled by the methods themselves

		getSync: function (id) {
			// summary:
			//		Retrieves an object by its identity
			// id: Number
			//		The identity to use to lookup the object
			// returns: Object
			//		The object in the store that matches the given id.
			return this.storage.fullData[this.storage.index[id]];
		},
		putSync: function (object, options) {
			// summary:
			//		Stores an object
			// object: Object
			//		The object to store.
			// options: dstore/Store.PutDirectives?
			//		Additional metadata for storing the data.  Includes an 'id'
			//		property if a specific id is to be used.
			// returns: Number

			options = options || {};

			var storage = this.storage,
				index = storage.index,
				data = storage.fullData;

			var Model = this.Model;
			if (Model && !(object instanceof Model)) {
				// if it is not the correct type, restore a
				// properly typed version of the object. Note that we do not allow
				// mutation here
				object = this._restore(object);
			}
			var id = this.getIdentity(object);
			if (id == null) {
				this._setIdentity(object, ('id' in options) ? options.id : Math.random());
				id = this.getIdentity(object);
			}
			storage.version++;

			var eventType = id in index ? 'update' : 'add',
				event = { target: object },
				previousIndex,
				defaultDestination;
			if (eventType === 'update') {
				if (options.overwrite === false) {
					throw new Error('Object already exists');
				} else {
					data.splice(previousIndex = index[id], 1);
					defaultDestination = previousIndex;
				}
			} else {
				defaultDestination = this.defaultNewToStart ? 0 : data.length;
			}

			var destination;
			if ('beforeId' in options) {
				var beforeId = options.beforeId;

				if (beforeId === null) {
					destination = data.length;
				} else {
					destination = index[beforeId];

					// Account for the removed item
					if (previousIndex < destination) {
						--destination;
					}
				}

				if (destination !== undefined) {
					event.beforeId = beforeId;
				} else {
					console.error('options.beforeId was specified but no corresponding index was found');
					destination = defaultDestination;
				}
			} else {
				destination = defaultDestination;
			}
			data.splice(destination, 0, object);

			// the fullData has been changed, so the index needs updated
			var i = isFinite(previousIndex) ? Math.min(previousIndex, destination) : destination;
			for (var l = data.length; i < l; ++i) {
				index[this.getIdentity(data[i])] = i;
			}

			this.emit(eventType, event);

			return object;
		},
		addSync: function (object, options) {
			// summary:
			//		Creates an object, throws an error if the object already exists
			// object: Object
			//		The object to store.
			// options: dstore/Store.PutDirectives?
			//		Additional metadata for storing the data.  Includes an 'id'
			//		property if a specific id is to be used.
			// returns: Number
			(options = options || {}).overwrite = false;
			// call put with overwrite being false
			return this.putSync(object, options);
		},
		removeSync: function (id) {
			// summary:
			//		Deletes an object by its identity
			// id: Number
			//		The identity to use to delete the object
			// returns: Boolean
			//		Returns true if an object was removed, falsy (undefined) if no object matched the id
			var storage = this.storage;
			var index = storage.index;
			var data = storage.fullData;
			if (id in index) {
				var removed = data.splice(index[id], 1)[0];
				// now we have to reindex
				this._reindex();
				this.emit('delete', {id: id, target: removed});
				return true;
			}
		},
		setData: function (data) {
			// summary:
			//		Sets the given data as the source for this store, and indexes it
			// data: Object[]
			//		An array of objects to use as the source of data. Note that this
			//		array will not be copied, it is used directly and mutated as
			//		data changes.

			if (this.parse) {
				data = this.parse(data);
			}
			if (data.items) {
				// just for convenience with the data format ItemFileReadStore expects
				this.idProperty = data.identifier || this.idProperty;
				data = data.items;
			}
			var storage = this.storage;
			storage.fullData = this.data = data;
			this._reindex();
		},

		_reindex: function () {
			var storage = this.storage;
			var index = storage.index = {};
			var data = storage.fullData;
			var Model = this.Model;
			var ObjectPrototype = Object.prototype;
			for (var i = 0, l = data.length; i < l; i++) {
				var object = data[i];
				if (Model && !(object instanceof Model)) {
					var restoredObject = this._restore(object,
							// only allow mutation if it is a plain object
							// (which is generally the expected input),
							// if "typed" objects are actually passed in, we will
							// respect that, and leave the original alone
							object.__proto__ === ObjectPrototype);
					if (object !== restoredObject) {
						// a new object was generated in the restoration process,
						// so we have to update the item in the data array.
						data[i] = object = restoredObject;
					}
				}
				index[this.getIdentity(object)] = i;
			}
			storage.version++;
		},

		fetchSync: function () {
			var data = this.data;
			if (!data || data._version !== this.storage.version) {
				// our data is absent or out-of-date, so we requery from the root
				// start with the root data
				data = this.storage.fullData;
				var queryLog = this.queryLog;
				// iterate through the query log, applying each querier
				for (var i = 0, l = queryLog.length; i < l; i++) {
					data = queryLog[i].querier(data);
				}
				// store it, with the storage version stamp
				data._version = this.storage.version;
				this.data = data;
			}
			return new QueryResults(data);
		},

		fetchRangeSync: function (kwArgs) {
			var data = this.fetchSync(),
				start = kwArgs.start,
				end = kwArgs.end;
			return new QueryResults(data.slice(start, end), {
				totalLength: data.length
			});
		},

		_includePropertyInSubCollection: function (name) {
			return name !== 'data' && this.inherited(arguments);
		}
	});
});

},
'dstore/Store':function(){
define([
	'dojo/_base/lang',
	'dojo/_base/array',
	'dojo/aspect',
	'dojo/has',
	'dojo/when',
	'dojo/Deferred',
	'dojo/_base/declare',
	'./QueryMethod',
	'./Filter',
	'dojo/Evented'
], function (lang, arrayUtil, aspect, has, when, Deferred, declare, QueryMethod, Filter, Evented) {

	// module:
	//		dstore/Store
	/* jshint proto: true */
	// detect __proto__, and avoid using it on Firefox, as they warn about
	// deoptimizations. The watch method is a clear indicator of the Firefox
	// JS engine.
	has.add('object-proto', !!{}.__proto__ && !({}).watch);
	var hasProto = has('object-proto');

	function emitUpdateEvent(type) {
		return function (result, args) {
			var self = this;
			when(result, function (result) {
				var event = { target: result },
					options = args[1] || {};
				if ('beforeId' in options) {
					event.beforeId = options.beforeId;
				}
				self.emit(type, event);
			});

			return result;
		};
	}

	var base = Evented;
	/*=====
	base = [ Evented, Collection ];
	=====*/

	return /*==== Store= ====*/declare(base, {
		constructor: function (options) {
			// perform the mixin
			options && declare.safeMixin(this, options);

			if (this.Model && this.Model.createSubclass) {
				// we need a distinct model for each store, so we can
				// save the reference back to this store on it.
				// we always create a new model to be safe.
				this.Model = this.Model.createSubclass([]).extend({
					// give a reference back to the store for saving, etc.
					_store: this
				});
			}

			// the object the store can use for holding any local data or events
			this.storage = new Evented();
			var store = this;
			if (this.autoEmitEvents) {
				// emit events when modification operations are called
				aspect.after(this, 'add', emitUpdateEvent('add'));
				aspect.after(this, 'put', emitUpdateEvent('update'));
				aspect.after(this, 'remove', function (result, args) {
					when(result, function () {
						store.emit('delete', {id: args[0]});
					});
					return result;
				});
			}
		},

		// autoEmitEvents: Boolean
		//		Indicates if the events should automatically be fired for put, add, remove
		//		method calls. Stores may wish to explicitly fire events, to control when
		//		and which event is fired.
		autoEmitEvents: true,

		// idProperty: String
		//		Indicates the property to use as the identity property. The values of this
		//		property should be unique.
		idProperty: 'id',

		// queryAccessors: Boolean
		//		Indicates if client-side query engine filtering should (if the store property is true)
		//		access object properties through the get() function (enabling querying by
		//		computed properties), or if it should (by setting this to false) use direct/raw
		// 		property access (which may more closely follow database querying style).
		queryAccessors: true,

		getIdentity: function (object) {
			// summary:
			//		Returns an object's identity
			// object: Object
			//		The object to get the identity from
			// returns: String|Number

			return object.get ? object.get(this.idProperty) : object[this.idProperty];
		},

		_setIdentity: function (object, identityArg) {
			// summary:
			//		Sets an object's identity
			// description:
			//		This method sets an object's identity and is useful to override to support
			//		multi-key identities and object's whose properties are not stored directly on the object.
			// object: Object
			//		The target object
			// identityArg:
			//		The argument used to set the identity

			if (object.set) {
				object.set(this.idProperty, identityArg);
			} else {
				object[this.idProperty] = identityArg;
			}
		},

		forEach: function (callback, thisObject) {
			var collection = this;
			return when(this.fetch(), function (data) {
				for (var i = 0, l = data.length; i < l; i++) {
					callback.call(thisObject, data[i], i, collection);
				}
				return data;
			});
		},
		on: function (type, listener) {
			return this.storage.on(type, listener);
		},
		emit: function (type, event) {
			event = event || {};
			event.type = type;
			try {
				return this.storage.emit(type, event);
			} finally {
				// Return the initial value of event.cancelable because a listener error makes it impossible
				// to know whether the event was actually canceled
				return event.cancelable;
			}
		},

		// parse: Function
		//		One can provide a parsing function that will permit the parsing of the data. By
		//		default we assume the provide data is a simple JavaScript array that requires
		//		no parsing (subclass stores may provide their own default parse function)
		parse: null,

		// stringify: Function
		//		For stores that serialize data (to send to a server, for example) the stringify
		//		function can be specified to control how objects are serialized to strings
		stringify: null,

		// Model: Function
		//		This should be a entity (like a class/constructor) with a 'prototype' property that will be
		//		used as the prototype for all objects returned from this store. One can set
		//		this to the Model from dmodel/Model to return Model objects, or leave this
		//		to null if you don't want any methods to decorate the returned
		//		objects (this can improve performance by avoiding prototype setting),
		Model: null,

		_restore: function (object, mutateAllowed) {
			// summary:
			//		Restores a plain raw object, making an instance of the store's model.
			//		This is called when an object had been persisted into the underlying
			//		medium, and is now being restored. Typically restored objects will come
			//		through a phase of deserialization (through JSON.parse, DB retrieval, etc.)
			//		in which their __proto__ will be set to Object.prototype. To provide
			//		data model support, the returned object needs to be an instance of the model.
			//		This can be accomplished by setting __proto__ to the model's prototype
			//		or by creating a new instance of the model, and copying the properties to it.
			//		Also, model's can provide their own restore method that will allow for
			//		custom model-defined behavior. However, one should be aware that copying
			//		properties is a slower operation than prototype assignment.
			//		The restore process is designed to be distinct from the create process
			//		so their is a clear delineation between new objects and restored objects.
			// object: Object
			//		The raw object with the properties that need to be defined on the new
			//		model instance
			// mutateAllowed: boolean
			//		This indicates if restore is allowed to mutate the original object
			//		(by setting its __proto__). If this isn't true, than the restore should
			//		copy the object to a new object with the correct type.
			// returns: Object
			//		An instance of the store model, with all the properties that were defined
			//		on object. This may or may not be the same object that was passed in.
			var Model = this.Model;
			if (Model && object) {
				var prototype = Model.prototype;
				var restore = prototype._restore;
				if (restore) {
					// the prototype provides its own restore method
					object = restore.call(object, Model, mutateAllowed);
				} else if (hasProto && mutateAllowed) {
					// the fast easy way
					// http://jsperf.com/setting-the-prototype
					object.__proto__ = prototype;
				} else {
					// create a new object with the correct prototype
					object = lang.delegate(prototype, object);
				}
			}
			return object;
		},

		create: function (properties) {
			// summary:
			//		This creates a new instance from the store's model.
			//	properties:
			//		The properties that are passed to the model constructor to
			//		be copied onto the new instance. Note, that should only be called
			//		when new objects are being created, not when existing objects
			//		are being restored from storage.
			return new this.Model(properties);
		},

		_createSubCollection: function (kwArgs) {
			var newCollection = lang.delegate(this.constructor.prototype);

			for (var i in this) {
				if (this._includePropertyInSubCollection(i, newCollection)) {
					newCollection[i] = this[i];
				}
			}

			return declare.safeMixin(newCollection, kwArgs);
		},

		_includePropertyInSubCollection: function (name, subCollection) {
			return !(name in subCollection) || subCollection[name] !== this[name];
		},

		// queryLog: __QueryLogEntry[]
		//		The query operations represented by this collection
		queryLog: [],	// NOTE: It's ok to define this on the prototype because the array instance is never modified

		filter: new QueryMethod({
			type: 'filter',
			normalizeArguments: function (filter) {
				var Filter = this.Filter;
				if (filter instanceof Filter) {
					return [filter];
				}
				return [new Filter(filter)];
			}
		}),

		Filter: Filter,

		sort: new QueryMethod({
			type: 'sort',
			normalizeArguments: function (property, descending) {
				var sorted;
				if (typeof property === 'function') {
					sorted = [ property ];
				} else {
					if (property instanceof Array) {
						sorted = property.slice();
					} else if (typeof property === 'object') {
						sorted = [].slice.call(arguments);
					} else {
						sorted = [{ property: property, descending: descending }];
					}

					sorted = arrayUtil.map(sorted, function (sort) {
						// copy the sort object to avoid mutating the original arguments
						sort = lang.mixin({}, sort);
						sort.descending = !!sort.descending;
						return sort;
					});
					// wrap in array because sort objects are a single array argument
					sorted = [ sorted ];
				}
				return sorted;
			}
		}),

		_getQuerierFactory: function (type) {
			var uppercaseType = type[0].toUpperCase() + type.substr(1);
			return this['_create' + uppercaseType + 'Querier'];
		}

/*====,
		get: function (id) {
			// summary:
			//		Retrieves an object by its identity
			// id: Number
			//		The identity to use to lookup the object
			// returns: Object
			//		The object in the store that matches the given id.
		},
		put: function (object, directives) {
			// summary:
			//		Stores an object
			// object: Object
			//		The object to store.
			// directives: dstore/Store.PutDirectives?
			//		Additional directives for storing objects.
			// returns: Object
			//		The object that was stored, with any changes that were made by
			//		the storage system (like generated id)
		},
		add: function (object, directives) {
			// summary:
			//		Creates an object, throws an error if the object already exists
			// object: Object
			//		The object to store.
			// directives: dstore/Store.PutDirectives?
			//		Additional directives for creating objects.
			// returns: Object
			//		The object that was stored, with any changes that were made by
			//		the storage system (like generated id)
		},
		remove: function (id) {
			// summary:
			//		Deletes an object by its identity
			// id: Number
			//		The identity to use to delete the object
		},
		transaction: function () {
			// summary:
			//		Starts a new transaction.
			//		Note that a store user might not call transaction() prior to using put,
			//		delete, etc. in which case these operations effectively could be thought of
			//		as "auto-commit" style actions.
			// returns: dstore/Store.Transaction
			//		This represents the new current transaction.
		},
		getChildren: function (parent) {
			// summary:
			//		Retrieves the children of an object.
			// parent: Object
			//		The object to find the children of.
			// returns: dstore/Store.Collection
			//		A result set of the children of the parent object.
		}
====*/
	});
});


/*====
	var Collection = declare(null, {
		// summary:
		//		This is an abstract API for a collection of objects, which can be filtered,
		//		sorted, and sliced to create new collections. This is considered to be base
		//		interface for all stores and  query results in dstore. Note that the objects in the
		//		collection may not be immediately retrieved from the underlying data
		//		storage until they are actually accessed through forEach() or fetch().

		filter: function (query) {
			// summary:
			//		Filters the collection, returning a new subset collection
			// query: String|Object|Function
			//		The query to use for retrieving objects from the store.
			// returns: Collection
		},
		sort: function (property, descending) {
			// summary:
			//		Sorts the current collection into a new collection, reordering the objects by the provided sort order.
			// property: String|Function
			//		The property to sort on. Alternately a function can be provided to sort with
			// descending?: Boolean
			//		Indicate if the sort order should be descending (defaults to ascending)
			// returns: Collection
		},
		fetchRange: function (kwArgs) {
			// summary:
			//		Retrieves a range of objects from the collection, returning a promise to an array.
			// kwArgs.start: Number
			//		The starting index of objects to return (0-indexed)
			// kwArgs.end: Number
			//		The exclusive end of objects to return
			// returns: Collection
		},
		forEach: function (callback, thisObject) {
			// summary:
			//		Iterates over the query results, based on
			//		https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/forEach.
			//		Note that this may executed asynchronously (in which case it will return a promise),
			//		and the callback may be called after this function returns.
			// callback:
			//		Function that is called for each object in the query results
			// thisObject:
			//		The object to use as |this| in the callback.
			// returns:
			//		undefined|Promise
		},
		fetch: function () {
			// summary:
			//		This can be called to materialize and request the data behind this collection.
			//		Often collections may be lazy, and won't retrieve their underlying data until
			//		forEach or fetch is called. This returns an array, or for asynchronous stores,
			//		this will return a promise, resolving to an array of objects, once the
			//		operation is complete.
			//	returns Array|Promise
		},
		on: function (type, listener) {
			// summary:
			//		This registers a callback for notification of when data is modified in the query results.
			// type: String
			//		There are four types of events defined in this API:
			//		- add - A new object was added
			//		- update - An object was updated
			//		- delete - An object was deleted
			// listener: Function
			//		The listener function is called when objects in the query results are modified
			//		to affect the query result. The listener function is called with a single event object argument:
			//		| listener(event);
			//
			//		- The event object as the following properties:
			//		- type - The event type (of the four above)
			//		- target - This indicates the object that was create or modified.
			//		- id - If an object was removed, this indicates the object that was removed.
			//		The next two properties will only be available if array tracking is employed,
			//		which is usually provided by dstore/Trackable
			//		- previousIndex - The previousIndex parameter indicates the index in the result array where
			//		the object used to be. If the value is -1, then the object is an addition to
			//		this result set (due to a new object being created, or changed such that it
			//		is a part of the result set).
			//		- index - The inex parameter indicates the index in the result array where
			//		the object should be now. If the value is -1, then the object is a removal
			//		from this result set (due to an object being deleted, or changed such that it
			//		is not a part of the result set).

		}
	});

	Collection.SortInformation = declare(null, {
		// summary:
		//		An object describing what property to sort on, and the direction of the sort.
		// property: String
		//		The name of the property to sort on.
		// descending: Boolean
		//		The direction of the sort.  Default is false.
	});
	Store.Collection = Collection;

	Store.PutDirectives = declare(null, {
		// summary:
		//		Directives passed to put() and add() handlers for guiding the update and
		//		creation of stored objects.
		// id: String|Number?
		//		Indicates the identity of the object if a new object is created
		// beforeId: String?
		//		If the collection of objects in the store has a natural ordering,
		//		this indicates that the created or updated object should be placed before the
		//		object whose identity is specified as the value of this property. A value of null indicates that the
		//		object should be last.
		// parent: Object?,
		//		If the store is hierarchical (with single parenting) this property indicates the
		//		new parent of the created or updated object.
		// overwrite: Boolean?
		//		If this is provided as a boolean it indicates that the object should or should not
		//		overwrite an existing object. A value of true indicates that a new object
		//		should not be created, the operation should update an existing object. A
		//		value of false indicates that an existing object should not be updated, a new
		//		object should be created (which is the same as an add() operation). When
		//		this property is not provided, either an update or creation is acceptable.
	});

	Store.Transaction = declare(null, {
		// summary:
		//		This is an object returned from transaction() calls that represents the current
		//		transaction.

		commit: function () {
			// summary:
			//		Commits the transaction. This may throw an error if it fails. Of if the operation
			//		is asynchronous, it may return a promise that represents the eventual success
			//		or failure of the commit.
		},
		abort: function (callback, thisObject) {
			// summary:
			//		Aborts the transaction. This may throw an error if it fails. Of if the operation
			//		is asynchronous, it may return a promise that represents the eventual success
			//		or failure of the abort.
		}
	});

	var __QueryLogEntry = {
		type: String
			The query type
		arguments: Array
			The original query arguments
		normalizedArguments: Array
			The normalized query arguments
		querier: Function?
			A client-side implementation of the query that takes an item array and returns an item array
	};
====*/

},
'dstore/QueryMethod':function(){
define([], function () {
	/*=====
	var __QueryMethodArgs = {
		// type: String
		//		The type of the query. This identifies the query's type in the query log
		//		and the name of the corresponding query engine method.
		// normalizeArguments: Function?
		//		A function that normalizes arguments for consumption by a query engine
		// applyQuery: Function?
		//		A function that takes the query's new subcollection and the query's log entry
		//		and applies it to the new subcollection. This is useful for collections that need
		//		to both declare and implement new query methods.
		// querierFactory: Function?
		//		A factory function that provides a default querier implementation to use when
		//		a collection does not define its own querier factory method for this query type.
	};
	=====*/
	return function QueryMethod(/*__QueryMethodArgs*/ kwArgs) {
		// summary:
		//		The constructor for a dstore collection query method
		// description:
		//		This is the constructor for a collection query method. It encapsulates the following:
		//		* Creating a new subcollection for the query results
		//		* Logging the query in the collection's `queryLog`
		//		* Normalizing query arguments
		//		* Applying the query engine
		// kwArgs:
		//		The properties that define the query method
		// returns: Function
		//		Returns a function that takes query arguments and returns a new collection with
		//		the query associated with it.

		var type = kwArgs.type,
			normalizeArguments = kwArgs.normalizeArguments,
			applyQuery = kwArgs.applyQuery,
			defaultQuerierFactory = kwArgs.querierFactory;

		return function () {
			// summary:
			//		A query method whose arguments are determined by the query type
			// returns: dstore/Collection
			//		A collection representing the query results

			var originalArguments = Array.prototype.slice.call(arguments),
				normalizedArguments = normalizeArguments
					? normalizeArguments.apply(this, originalArguments)
					: originalArguments,
				logEntry = {
					type: type,
					arguments: originalArguments,
					normalizedArguments: normalizedArguments
				},
				querierFactory = this._getQuerierFactory(type) || defaultQuerierFactory;

			if (querierFactory) {
				// Call the query factory in store context to support things like
				// mapping a filter query's string argument to a custom filter method on the collection
				logEntry.querier = querierFactory.apply(this, normalizedArguments);
			}

			var newCollection = this._createSubCollection({
				queryLog: this.queryLog.concat(logEntry)
			});

			return applyQuery ? applyQuery.call(this, newCollection, logEntry) : newCollection;
		};
	};
});

},
'dstore/Filter':function(){
define(['dojo/_base/declare'], function (declare) {
	// a Filter builder
	function filterCreator(type) {
		// constructs a new filter based on type, used to create each method
		return function newFilter() {
			var Filter = this.constructor;
			var filter = new Filter();
			filter.type = type;
			filter.args = arguments;
			if (this.type) {
				// we are chaining, so combine with an and operator
				return filterCreator('and').call(Filter.prototype, this, filter);
			}
			return filter;
		};
	}
	var Filter = declare(null, {
		constructor: function (filterArg) {
			var argType = typeof filterArg;
			switch (argType) {
				case 'object':
					var filter = this;
					// construct a filter based on the query object
					for (var key in filterArg){
						var value = filterArg[key];
						if (value instanceof this.constructor) {
							// fully construct the filter from the single arg
							filter = filter[value.type](key, value.args[0]);
						} else if (value && value.test) {
							// support regex
							filter = filter.match(key, value);
						} else {
							filter = filter.eq(key, value);
						}
					}
					this.type = filter.type;
					this.args = filter.args;
					break;
				case 'function': case 'string':
					// allow string and function args as well
					this.type = argType;
					this.args = [filterArg];
			}
		},
		// define our operators
		and: filterCreator('and'),
		or: filterCreator('or'),
		eq: filterCreator('eq'),
		ne: filterCreator('ne'),
		lt: filterCreator('lt'),
		lte: filterCreator('lte'),
		gt: filterCreator('gt'),
		gte: filterCreator('gte'),
		'in': filterCreator('in'),
		match: filterCreator('match')
	});
	Filter.filterCreator = filterCreator;
	return Filter;
});
},
'dstore/Promised':function(){
define([
	'dojo/_base/declare',
	'dojo/Deferred',
	'./QueryResults',
	'dojo/when'
], function (declare, Deferred, QueryResults, when) {
	// module:
	//		this is a mixin that can be used to provide async methods,
	// 		by implementing their sync counterparts
	function promised(method, query) {
		return function() {
			var deferred = new Deferred();
			try {
				deferred.resolve(this[method].apply(this, arguments));
			} catch (error) {
				deferred.reject(error);
			}
			if (query) {
				// need to create a QueryResults and ensure the totalLength is
				// a promise.
				var queryResults = new QueryResults(deferred.promise);
				queryResults.totalLength = when(queryResults.totalLength);
				return queryResults;
			}
			return deferred.promise;
		};
	}
	return declare(null, {
		get: promised('getSync'),
		put: promised('putSync'),
		add: promised('addSync'),
		remove: promised('removeSync'),
		fetch: promised('fetchSync', true),
		fetchRange: promised('fetchRangeSync', true)
	});
});

},
'dstore/SimpleQuery':function(){
define([
	'dojo/_base/declare',
	'dojo/_base/array'
], function (declare, arrayUtil) {

	// module:
	//		dstore/SimpleQuery

	var comparators = {
		eq: function (value, required) {
			return value === required;
		},
		'in': function(value, required) {
			return arrayUtil.indexOf(required, value) > -1;
		},
		ne: function (value, required) {
			return value !== required;
		},
		lt: function (value, required) {
			return value < required;
		},
		lte: function (value, required) {
			return value <= required;
		},
		gt: function (value, required) {
			return value > required;
		},
		gte: function (value, required) {
			return value >= required;
		},
		match: function (value, required, object) {
			return required.test(value, object);
		}
	};

	return declare(null, {
		// summary:
		//		Mixin providing querier factories for core query types

		_createFilterQuerier: function (filter) {
			// create our matching filter function
			var queryAccessors = this.queryAccessors;
			var collection = this;
			var querier = getQuerier(filter);

			function getQuerier(filter) {
				var type = filter.type;
				var args = filter.args;
				var comparator = collection._getFilterComparator(type);
				if (comparator) {
					// it is a comparator
					var firstArg = args[0];
					var secondArg = args[1];
					return function (object) {
						// get the value for the property and compare to expected value
						return comparator(queryAccessors && object.get ? object.get(firstArg) : object[firstArg], secondArg, object);
					};
				}
				switch (type) {
					case 'and': case 'or':
						for (var i = 0, l = args.length; i < l; i++) {
							// combine filters, using and or or
							var nextQuerier = getQuerier(args[i]);
							if (querier) {
								// combine the last querier with a new one
								querier = (function(a, b) {
									return type === 'and' ?
										function(object) {
											return a(object) && b(object);
										} :
										function(object) {
											return a(object) || b(object);

										};
								})(querier, nextQuerier);
							} else {
								querier = nextQuerier;
							}
						}
						return querier;
					case 'function':
						return args[0];
					case 'string':
						// named filter
						var filterFunction = collection[args[0]];
						if (!filterFunction) {
							throw new Error('No filter function ' + args[0] + ' was found in the collection');
						}
						return filterFunction;
					case undefined:
						return function () {
							return true;
						};
					default:
						throw new Error('Unknown filter operation "' + type + '"');
				}
			}
			return function (data) {
				return arrayUtil.filter(data, querier);
			};
		},

		_getFilterComparator: function (type) {
			// summary:
			//		Get the comparator for the specified type
			// returns: Function?

			return comparators[type] || this.inherited(arguments);
		}
		/* jshint ignore:start */
		,
		_createSortQuerier: function (sorted) {
			return function (data) {
				data = data.slice();
				data.sort(typeof sorted == 'function' ? sorted : function (a, b) {
					for (var i = 0; i < sorted.length; i++) {
						var comparison;
						if (typeof sorted[i] == 'function') {
							comparison = sorted[i](a, b);
						} else {
							var property = sorted[i].property;
							var descending = sorted[i].descending;
							var aValue = a.get ? a.get(property) : a[property];
							var bValue = b.get ? b.get(property) : b[property];

							aValue != null && (aValue = aValue.valueOf());
							bValue != null && (bValue = bValue.valueOf());

							comparison = aValue === bValue
								? 0
								: (!!descending === (aValue === null || aValue > bValue && bValue !== null) ? -1 : 1);
						}

						if (comparison !== 0) {
							return comparison;
						}
					}
					return 0;
				});
				return data;
			};
		}
		/* jshint ignore:end */
	});
});

},
'lib/Editor':function(){
define([
	'dojo/_base/declare',
	'dojo/_base/lang',
	'dojo/Deferred',
	'dojo/dom-construct',
	'dojo/dom-class',
	'dojo/on',
	'dojo/has',
	'dojo/query',
	'dgrid/Grid',
	'dojo/_base/sniff'
], function (declare, lang, Deferred, domConstruct, domClass, on, has, query, Grid) {

	return declare(null, {
		constructor: function () {
			this._editorInstances = {};
			this._editorColumnListeners = [];
			this._editorsPendingStartup = [];
		},

		postCreate: function () {
			var self = this;

			this.inherited(arguments);

			this.on('.dgrid-input:focusin', function () {
				self._focusedEditorCell = self.cell(this);
			});
			this._editorFocusoutHandle = on.pausable(this.domNode, '.dgrid-input:focusout', function () {
				self._focusedEditorCell = null;
			});
			this._listeners.push(this._editorFocusoutHandle);
		},

		insertRow: function () {
			var rowElement = this.inherited(arguments);
			var row = this.row(rowElement);
			var previouslyFocusedCell = this._previouslyFocusedEditorCell;

			if (previouslyFocusedCell && previouslyFocusedCell.row.id === row.id) {
				this.edit(this.cell(row, previouslyFocusedCell.column.id));
			}
			return rowElement;
		},

		removeRow: function (rowElement) {
			var self = this;
			var focusedCell = this._focusedEditorCell;

			if (focusedCell && focusedCell.row.id === this.row(rowElement).id) {
				this._previouslyFocusedEditorCell = focusedCell;
				// Pause the focusout handler until after this row has had
				// time to re-render, if this removal is part of an update.
				// A setTimeout is used here instead of resuming in insertRow,
				// since if a row were actually removed (not updated) while
				// editing, the handler would not be properly hooked up again
				// for future occurrences.
				this._editorFocusoutHandle.pause();
				setTimeout(function () {
					self._editorFocusoutHandle.resume();
					self._previouslyFocusedEditorCell = null;
				}, 0);
			}

			for (var i = this._alwaysOnWidgetColumns.length; i--;) {
				// Destroy always-on editor widgets during the row removal operation,
				// but don't trip over loading nodes from incomplete requests
				var cellElement = this.cell(rowElement, this._alwaysOnWidgetColumns[i].id).element,
					widget = cellElement && (cellElement.contents || cellElement).widget;
				if (widget) {
					this._editorFocusoutHandle.pause();
					widget.destroyRecursive();
				}
			}

			return this.inherited(arguments);
		},

		renderArray: function () {
			var rows = this.inherited(arguments);
			if (rows.length) {
				// Finish processing any pending editors that are now displayed
				this._startupPendingEditors();
			}
			else {
				this._editorsPendingStartup = [];
			}
			return rows;
		},

		_onNotification: function () {
			this.inherited(arguments);
			this._startupPendingEditors();
		},

		_destroyColumns: function () {
			this._editorStructureCleanup();
			this.inherited(arguments);
		},

		_editorStructureCleanup: function () {
			var editorInstances = this._editorInstances;
			var listeners = this._editorColumnListeners;

			if (this._editTimer) {
				clearTimeout(this._editTimer);
			}
			// Do any clean up of previous column structure.
			for (var columnId in editorInstances) {
				var editor = editorInstances[columnId];
				if (editor.domNode) {
					// The editor is a widget
					editor.destroyRecursive();
				}
			}
			this._editorInstances = {};

			for (var i = listeners.length; i--;) {
				listeners[i].remove();
			}
			this._editorColumnListeners = [];
			this._editorsPendingStartup = [];
		},

		_configColumns: function () {
			var columnArray = this.inherited(arguments);
			this._alwaysOnWidgetColumns = [];
			for (var i = 0, l = columnArray.length; i < l; i++) {
				if (columnArray[i].editor) {
					this._configureEditorColumn(columnArray[i]);
				}
			}
			return columnArray;
		},

		_configureEditorColumn: function (column) {
			// summary:
			//		Adds editing capability to a column's cells.

			var editor = column.editor;
			var self = this;

			var originalRenderCell = column.renderCell || this._defaultRenderCell;
			var editOn = column.editOn;
			var isWidget = typeof editor !== 'string';

			if (editOn) {
				// Create one shared widget/input to be swapped into the active cell.
				this._editorInstances[column.id] = this._createSharedEditor(column, originalRenderCell);
			}
			else if (isWidget) {
				// Append to array iterated in removeRow
				this._alwaysOnWidgetColumns.push(column);
			}

			column.renderCell = editOn ? function (object, value, cell, options) {
				// TODO: Consider using event delegation
				// (Would require using dgrid's focus events for activating on focus,
				// which we already advocate in docs for optimal use)

				if (!options || !options.alreadyHooked) {
					self._editorColumnListeners.push(
						on(cell, editOn, function () {
							self._activeOptions = options;
							self.edit(this);
						})
					);
				}

				// initially render content in non-edit mode
				return originalRenderCell.call(column, object, value, cell, options);

			} : function (object, value, cell, options) {
				// always-on: create editor immediately upon rendering each cell
				if (!column.canEdit || column.canEdit(object, value)) {
					var cmp = self._createEditor(column);
					self._showEditor(cmp, column, cell, value);
					// Maintain reference for later use.
					cell[isWidget ? 'widget' : 'input'] = cmp;
				}
				else {
					return originalRenderCell.call(column, object, value, cell, options);
				}
			};
		},

		edit: function (cell) {
			// summary:
			//		Shows/focuses the editor for a given grid cell.
			// cell: Object
			//		Cell (or something resolvable by grid.cell) to activate editor on.
			// returns:
			//		If the cell is editable, returns a promise resolving to the editor
			//		input/widget when the cell editor is focused.
			//		If the cell is not editable, returns null.

			var self = this;
			var column;
			var cellElement;
			var dirty;
			var field;
			var value;
			var cmp;
			var dfd;

			function showEditor(dfd) {
				self._activeCell = cellElement;
				self._showEditor(cmp, column, cellElement, value);

				// focus / blur-handler-resume logic is surrounded in a setTimeout
				// to play nice with Keyboard's dgrid-cellfocusin as an editOn event
				self._editTimer = setTimeout(function () {
					// focus the newly-placed control (supported by form widgets and HTML inputs)
					if (cmp.focus) {
						cmp.focus();
					}
					// resume blur handler once editor is focused
					if (column._editorBlurHandle) {
						column._editorBlurHandle.resume();
					}
					self._editTimer = null;
					dfd.resolve(cmp);
				}, 0);
			}

			if (!cell.column) {
				cell = this.cell(cell);
			}
			if (!cell || !cell.element) {
				return null;
			}

			column = cell.column;
			field = column.field;
			cellElement = cell.element.contents || cell.element;

			if ((cmp = this._editorInstances[column.id])) {
				// Shared editor (editOn used)
				if (this._activeCell !== cellElement) {
					// Get the cell value
					var row = cell.row;
					dirty = this.dirty && this.dirty[row.id];
					value = (dirty && field in dirty) ? dirty[field] :
						column.get ? column.get(row.data) : row.data[field];
					// Check to see if the cell can be edited
					if (!column.canEdit || column.canEdit(cell.row.data, value)) {
						dfd = new Deferred();

						// In some browsers, moving a DOM node causes a blur event to fire which in this case,
						// is a bad time for the blur handler to run.  Blur the input node first.
						var node = cmp.domNode || cmp;
						if (node.offsetWidth) {
							// The editor is visible.  Blur it.
							node.blur();
							// In IE, the blur does not complete immediately.
							// Push showing of the editor to the next turn.
							// (dfd will be resolved within showEditor)
							setTimeout(function () {
								showEditor(dfd);
							}, 0);
						} else {
							showEditor(dfd);
						}

						return dfd.promise;
					}
				}
			}
			else if (column.editor) {
				// editor but not shared; always-on
				cmp = cellElement.widget || cellElement.input;
				if (cmp) {
					dfd = new Deferred();
					if (cmp.focus) {
						cmp.focus();
					}
					dfd.resolve(cmp);
					return dfd.promise;
				}
			}
			return null;
		},

		_showEditor: function (cmp, column, cellElement, value) {
			// Places a shared editor into the newly-active cell in the column.
			// Also called when rendering an editor in an "always-on" editor column.

			var isWidget = cmp.domNode;
			// for regular inputs, we can update the value before even showing it
			if (!isWidget) {
				this._updateInputValue(cmp, value);
			}

			cellElement.innerHTML = '';
			domClass.add(cellElement, 'dgrid-cell-editing');
			cellElement.appendChild(cmp.domNode || cmp);

			if (isWidget && !column.editOn) {
				// Queue arguments to be run once editor is in DOM
				this._editorsPendingStartup.push([cmp, column, cellElement, value]);
			}
			else {
				this._startupEditor(cmp, column, cellElement, value);
			}
		},

		_startupEditor: function (cmp, column, cellElement, value) {
			// summary:
			//		Handles editor widget startup logic and updates the editor's value.

			if (cmp.domNode) {
				// For widgets, ensure startup is called before setting value, to maximize compatibility
				// with flaky widgets like dijit/form/Select.
				if (!cmp._started) {
					cmp.startup();
				}

				// Set value, but ensure it isn't processed as a user-generated change.
				// (Clear flag on a timeout to wait for delayed onChange to fire first)
				cmp._dgridIgnoreChange = true;
				cmp.set('value', value);
				setTimeout(function () {
					cmp._dgridIgnoreChange = false;
				}, 0);
			}

			// track previous value for short-circuiting or in case we need to revert
			cmp._dgridLastValue = value;
			// if this is an editor with editOn, also update _activeValue
			// (_activeOptions will have been updated previously)
			if (this._activeCell) {
				this._activeValue = value;
				// emit an event immediately prior to placing a shared editor
				on.emit(cellElement, 'dgrid-editor-show', {
					grid: this,
					cell: this.cell(cellElement),
					column: column,
					editor: cmp,
					bubbles: true,
					cancelable: false
				});
			}
		},

		_startupPendingEditors: function () {
			var args = this._editorsPendingStartup;
			for (var i = args.length; i--;) {
				this._startupEditor.apply(this, args[i]);
			}
			this._editorsPendingStartup = [];
		},

		_handleEditorChange: function (evt, column) {
			var target = evt.target;
			if ('_dgridLastValue' in target && target.className.indexOf('dgrid-input') > -1) {
				this._updatePropertyFromEditor(column || this.cell(target).column, target, evt);
			}
		},

		_createEditor: function (column) {
			// Creates an editor instance based on column definition properties,
			// and hooks up events.
			var editor = column.editor,
				editOn = column.editOn,
				self = this,
				Widget = editor,
				args,
				cmp,
				node,
				tagName,
				tagArgs = {};

			args = column.editorArgs || {};
			if (typeof args === 'function') {
				args = args.call(this, column);
			}

			if (Widget) {

				cmp = document.createElement(editor);
				node = cmp;
				console.log('node', node);

				// Add dgrid-input to className to make consistent with HTML inputs.
				node.className += ' dgrid-input';
				// For editOn editors, connect to onBlur rather than onChange, since
				// the latter is delayed by setTimeouts in Dijit and will fire too late.
				cmp.addEventListener(editOn ? 'blur' : 'change', function () {
					if (!cmp._dgridIgnoreChange) {
						self._updatePropertyFromEditor(column, this, {type: 'widget'});
					}
				});
			}
			else {
				// considerations for standard HTML form elements
				if (!this._hasInputListener) {
					// register one listener at the top level that receives events delegated
					this._hasInputListener = true;
					this.on('change', function (evt) {
						self._handleEditorChange(evt);
					});
					// also register a focus listener
				}

				if (editor === 'textarea') {
					tagName = 'textarea';
				}
				else {
					tagName = 'input';
					tagArgs.type = editor;
				}
				cmp = node = domConstruct.create(tagName, lang.mixin(tagArgs, {
					className: 'dgrid-input',
					name: column.field,
					tabIndex: isNaN(column.tabIndex) ? -1 : column.tabIndex
				}, args));

				if ( 10  < 9) {
					// IE<9 doesn't fire change events for all the right things,
					// and it doesn't bubble.
					if (editor === 'radio' || editor === 'checkbox') {
						// listen for clicks since IE doesn't fire change events properly for checks/radios
						this._editorColumnListeners.push(on(cmp, 'click', function (evt) {
							self._handleEditorChange(evt, column);
						}));
					}
					else {
						this._editorColumnListeners.push(on(cmp, 'change', function (evt) {
							self._handleEditorChange(evt, column);
						}));
					}
				}
			}

			if (column.autoSelect) {
				var selectNode = cmp.focusNode || cmp;
				if (selectNode.select) {
					on(selectNode, 'focus', function () {
						// setTimeout is needed for always-on editors on WebKit,
						// otherwise selection is reset immediately afterwards
						setTimeout(function () {
							selectNode.select();
						}, 0);
					});
				}
			}

			return cmp;
		},

		_createSharedEditor: function (column) {
			// Creates an editor instance with additional considerations for
			// shared usage across an entire column (for columns with editOn specified).

			var cmp = this._createEditor(column),
				self = this,
				isWidget = cmp.domNode,
				node = cmp.domNode || cmp,
				focusNode = cmp.focusNode || node,
				reset = isWidget ?
					function () {
						cmp.set('value', cmp._dgridLastValue);
					} :
					function () {
						self._updateInputValue(cmp, cmp._dgridLastValue);
						// Update property again in case we need to revert a previous change
						self._updatePropertyFromEditor(column, cmp);
					};

			function blur() {
				var element = self._activeCell;
				focusNode.blur();

				if (typeof self.focus === 'function') {
					// Dijit form widgets don't end up dismissed until the next turn,
					// so wait before calling focus (otherwise Keyboard will focus the
					// input again).  IE<9 needs to wait longer, otherwise the cell loses
					// focus after we've set it.
					setTimeout(function () {
						self.focus(element);
					}, isWidget &&  10  < 9 ? 15 : 0);
				}
			}

			function onblur() {
				var parentNode = node.parentNode,
					options = { alreadyHooked: true },
					cell = self.cell(node);

				// emit an event immediately prior to removing an editOn editor
				on.emit(cell.element, 'dgrid-editor-hide', {
					grid: self,
					cell: cell,
					column: column,
					editor: cmp,
					bubbles: true,
					cancelable: false
				});
				column._editorBlurHandle.pause();
				// Remove the editor from the cell, to be reused later.
				parentNode.removeChild(node);

				if (cell.row) {
					// If the row is still present (i.e. we didn't blur due to removal),
					// clear out the rest of the cell's contents, then re-render with new value.
					domClass.remove(cell.element, 'dgrid-cell-editing');
					domConstruct.empty(parentNode);
					Grid.appendIfNode(parentNode, column.renderCell(cell.row.data, self._activeValue, parentNode,
						self._activeOptions ? lang.delegate(options, self._activeOptions) : options));
				}

				// Reset state now that editor is deactivated;
				// reset _focusedEditorCell as well since some browsers will not
				// trigger the focusout event handler in this case
				self._focusedEditorCell = self._activeCell = self._activeValue = self._activeOptions = null;
			}

			function dismissOnKey(evt) {
				// Contains logic for reacting to enter/escape keypresses to save/cancel edits.
				// Calls `focusNode.blur()` in cases where field should be dismissed.
				var key = evt.keyCode || evt.which;

				if (key === 27) {
					// Escape: revert + dismiss
					reset();
					self._activeValue = cmp._dgridLastValue;
					blur();
				}
				else if (key === 13 && column.dismissOnEnter !== false) {
					// Enter: dismiss
					blur();
				}
			}

			// hook up enter/esc key handling
			this._editorColumnListeners.push(on(focusNode, 'keydown', dismissOnKey));

			// hook up blur handler, but don't activate until widget is activated
			(column._editorBlurHandle = on.pausable(cmp, 'blur', onblur)).pause();
			this._editorColumnListeners.push(column._editorBlurHandle);

			return cmp;
		},

		_updatePropertyFromEditor: function (column, cmp, triggerEvent) {
			var value,
				id,
				editedRow;

			if (!cmp.isValid || cmp.isValid()) {
				value = this._updateProperty((cmp.domNode || cmp).parentNode,
					this._activeCell ? this._activeValue : cmp._dgridLastValue,
					this._retrieveEditorValue(column, cmp), triggerEvent);

				if (this._activeCell) { // for editors with editOn defined
					this._activeValue = value;
				}
				else { // for always-on editors, update _dgridLastValue immediately
					cmp._dgridLastValue = value;
				}

				if (cmp.type === 'radio' && cmp.name && !column.editOn && column.field) {
					editedRow = this.row(cmp);

					// Update all other rendered radio buttons in the group
					query('input[type=radio][name=' + cmp.name + ']', this.contentNode).forEach(function (radioBtn) {
						var row = this.row(radioBtn);
						// Only update _dgridLastValue and the dirty data if it exists
						// and is not already false
						if (radioBtn !== cmp && radioBtn._dgridLastValue) {
							radioBtn._dgridLastValue = false;
							if (this.updateDirty) {
								this.updateDirty(row.id, column.field, false);
							}
							else {
								// update store-less grid
								row.data[column.field] = false;
							}
						}
					}, this);

					// Also update dirty data for rows that are not currently rendered
					for (id in this.dirty) {
						if (editedRow.id.toString() !== id && this.dirty[id][column.field]) {
							this.updateDirty(id, column.field, false);
						}
					}
				}
			}
		},

		_updateProperty: function (cellElement, oldValue, value, triggerEvent) {
			// Updates dirty hash and fires dgrid-datachange event for a changed value.
			var self = this;

			// test whether old and new values are inequal, with coercion (e.g. for Dates)
			if ((oldValue && oldValue.valueOf()) !== (value && value.valueOf())) {
				var cell = this.cell(cellElement);
				var row = cell.row;
				var column = cell.column;
				// Re-resolve cellElement in case the passed element was nested
				cellElement = cell.element;

				if (column.field && row) {
					var eventObject = {
						grid: this,
						cell: cell,
						oldValue: oldValue,
						value: value,
						bubbles: true,
						cancelable: true
					};
					if (triggerEvent && triggerEvent.type) {
						eventObject.parentType = triggerEvent.type;
					}

					if (on.emit(cellElement, 'dgrid-datachange', eventObject)) {
						if (this.updateDirty) {
							// for OnDemandGrid: update dirty data, and save if autoSave is true
							this.updateDirty(row.id, column.field, value);
							// perform auto-save (if applicable) in next tick to avoid
							// unintentional mishaps due to order of handler execution
							if (column.autoSave) {
								setTimeout(function () {
									self._trackError('save');
								}, 0);
							}
						}
						else {
							// update store-less grid
							row.data[column.field] = value;
						}
					}
					else {
						// Otherwise keep the value the same
						// For the sake of always-on editors, need to manually reset the value
						var cmp;
						if ((cmp = cellElement.widget)) {
							// set _dgridIgnoreChange to prevent an infinite loop in the
							// onChange handler and prevent dgrid-datachange from firing
							// a second time
							cmp._dgridIgnoreChange = true;
							cmp.set('value', oldValue);
							setTimeout(function () {
								cmp._dgridIgnoreChange = false;
							}, 0);
						}
						else if ((cmp = cellElement.input)) {
							this._updateInputValue(cmp, oldValue);
						}

						return oldValue;
					}
				}
			}
			return value;
		},

		_updateInputValue: function (input, value) {
			// summary:
			//		Updates the value of a standard input, updating the
			//		checked state if applicable.

			input.value = value;
			if (input.type === 'radio' || input.type === 'checkbox') {
				input.checked = input.defaultChecked = !!value;
			}
		},

		_retrieveEditorValue: function (column, cmp) {
			// summary:
			//		Intermediary between _convertEditorValue and
			//		_updatePropertyFromEditor.

			if (typeof cmp.get === 'function') { // widget
				return this._convertEditorValue(cmp.get('value'));
			}
			else { // HTML input
				return this._convertEditorValue(
					cmp[cmp.type === 'checkbox' || cmp.type === 'radio' ? 'checked' : 'value']);
			}
		},

		_convertEditorValue: function (value, oldValue) {
			// summary:
			//		Contains default logic for translating values from editors;
			//		tries to preserve type if possible.

			if (typeof oldValue === 'number') {
				value = isNaN(value) ? value : parseFloat(value);
			}
			else if (typeof oldValue === 'boolean') {
				value = value === 'true' ? true : value === 'false' ? false : value;
			}
			else if (oldValue instanceof Date) {
				var asDate = new Date(value);
				value = isNaN(asDate.getTime()) ? value : asDate;
			}
			return value;
		}
	});
});

},
'url:dgrid/css/dgrid.css':{"cssText":".dgrid{position:relative;overflow:hidden;border:1px solid #ddd;height:30em;display:block;}.dgrid-header{background-color:#eee;}.dgrid-header-row{position:absolute;right:17px;left:0;}.dgrid-header-scroll{position:absolute;top:0;right:0;}.dgrid-footer{position:absolute;bottom:0;width:100%;}.dgrid-header-hidden{font-size:0;height:0 !important;border-top:none !important;border-bottom:none !important;margin-top:0 !important;margin-bottom:0 !important;padding-top:0 !important;padding-bottom:0 !important;}.dgrid-footer-hidden{display:none;}.dgrid-sortable{cursor:pointer;}.dgrid-header, .dgrid-header-row, .dgrid-footer{overflow:hidden;background-color:#eee;}.dgrid-row-table{border-collapse:collapse;border:none;table-layout:fixed;empty-cells:show;width:100%;height:100%;}.dgrid-cell{padding:3px;text-align:left;overflow:hidden;vertical-align:top;border:1px solid #ddd;border-top-style:none;box-sizing:border-box;-moz-box-sizing:border-box;-ms-box-sizing:border-box;-webkit-box-sizing:border-box;}.dgrid-content{position:relative;height:99%;}.dgrid-scroller{overflow-x:auto;overflow-y:scroll;position:absolute;top:0px;margin-top:25px;bottom:0px;width:100%;}.dgrid-preload{font-size:0;line-height:0;}.dgrid-loading{position:relative;height:100%;}.dgrid-above{position:absolute;bottom:0;}.ui-icon{width:16px;height:16px;background-image:url(\"data:image/png;base64,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\");}.ui-icon-triangle-1-e{background-position:-32px -16px;}.ui-icon-triangle-1-se{background-position:-48px -16px;}.dgrid-expando-icon{width:16px;height:16px;}.dgrid-tree-container{-webkit-transition-duration:0.3s;-moz-transition-duration:0.3s;-ms-transition-duration:0.3s;-o-transition-duration:0.3s;transition-duration:0.3s;overflow:hidden;}.dgrid-tree-container.dgrid-tree-resetting{-webkit-transition-duration:0;-moz-transition-duration:0;-ms-transition-duration:0;-o-transition-duration:0;transition-duration:0;}.dgrid-sort-arrow{background-position:-64px -16px;display:block;float:right;margin:0 4px 0 5px;height:12px;}.dgrid-sort-up .dgrid-sort-arrow{background-position:0px -16px;}.dgrid-selected{background-color:#bfd6eb;}.dgrid-input{width:99%;}html.has-mozilla .dgrid-focus{outline-offset:-1px;}.dgrid-scrollbar-measure{width:100px;height:100px;overflow:scroll;position:absolute;top:-9999px;}.dgrid-autoheight{height:auto;}.dgrid-autoheight .dgrid-scroller{position:relative;overflow-y:hidden;}.dgrid-autoheight .dgrid-header-scroll{display:none;}.dgrid-autoheight .dgrid-header{right:0;}#dgrid-css-dgrid-loaded{display:none;}","xCss":"{/16background-image:url(\"data:image/png;base64,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\");}"}}});
define("dojo/out", [], 1);
