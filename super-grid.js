require([
	'dojo/_base/declare',
	'dstore/Memory',
	'dstore/Trackable',
	'dstore/Tree',
	'dgrid/Grid',
	'dgrid/Tree',
	'dgrid/Selection',
	'lib/Editor',
	'dgrid/OnDemandGrid',
	'dgrid/Selector',
], function (declare, Memory, Trackable, TreeStoreMixin, Grid, Tree, Selection, Editor, OnDemandGrid, Selector) {
	function createStore(data) {
		this.store = new(declare([Memory, Trackable, TreeStoreMixin]))({
			data: data
		});
	}

	function createGrid() {
		var _this = this;

		//Holding array for all the Classes we have to mixin
		var mixins = [];

		//Decide which mixins to push based on the Host Element's Attributes
		_this.getAttribute('tree') ? mixins.push(Tree) : null;

		//_this.getAttribute('selection') ? mixins.push(Selection) : null;

		//These have to pushed inspite of not getting defined in the Attributes
		mixins.push(OnDemandGrid);
		mixins.push(Selector);
		mixins.push(Editor);
		mixins.push(Tree);


		//Create a new instance of dgrid. For later purposes we are storing
		//the instance as an DOM Fproperty of the hsot element so it can
		//retrieved as Element.dgrid
		_this.dgrid = new declare(mixins)({

			//selectionMode: 'multiple',
			columns: _this.columnStructure,
			collection: _this.store

		});


		//Finally append the dGrid instance to the Host DOM.
		_this.appendChild(_this.dgrid.domNode);

		//Render the dgrid according to the value of the host DOM.
		//_this.dgrid.renderArray(_this.value)

	}

	//This function parses the <super-grid>'s children to find all
	//<super-column>s. Based on what it finds, a column object is built.
	//This column object is required by dGrid for making columns.
	function getColumnStructure() {
		var _this = this;
		var columns = [];


		Array.prototype.slice.call(_this.querySelectorAll('super-column')).forEach(function(superColumn) {
			var column = {
				field: superColumn.getAttribute('field'),
				label: superColumn.getAttribute('label') || superColumn.getAttribute('field'),
				className: superColumn.getAttribute('className') || '',
				sortable: superColumn.getAttribute('sortable') ? true : false,

			};


			var template = '';

			//We have an editor tag defined within <template> </template>
			if (template = superColumn.querySelector('template[data-editor]')) {

				//Convert something like -> 'a <paper-input> Hello </paper-input>' to -> 'paper-input'
				var patt = /<(?:"[^"]*"['"]*|'[^']*'['"]*|[^'">])+>/
				var editor = template.innerHTML.match(patt)[0].split('<')[1].split('>')[0];
				column.editor = editor;
			}

			//If the <template> isn't inside an editor then its a case of
			//rendering our dGrid cell in a custom way using Handlebars templates
			else if (template = superColumn.querySelector('template')) {
				column.renderCell = function(object, value, node, options) {

					//A holding div to convert the contents of the <template>
					//from string to DOM. Then return the DOM accoridng to
					//renderCell's specification.
					var div = document.createElement('div');

					//Handlebars has to be defined on the doc where super-grid is running.
					if (Handlebars) {
						div.innerHTML = Handlebars.compile(template.innerHTML)(object);
					}
					//If Handlebars isn't defined, simply dump the output as is.
					else {
						div.innerHTML = template.innerHTML
					}
					return div.children[0];
				}
			}

			column.selector = superColumn.getAttribute('selector') == 'checkbox' ? 'checkbox' : null;

			if (superColumn.getAttribute('renderExpando') == 'true') {
				column.renderExpando = true;
			}
			columns.push(column)
		})
		return columns;
	}

	Polymer({
		is: "super-grid",
		created: function() {
			this.columnStructure = getColumnStructure.call(this);
		},
		attached: function() {
			createStore.call(this, []);
			createGrid.call(this);
		},
		allowSelect: function(row){
			this.dgrid.allowSelect(row);
		},
		selectAll: function(){
			this.dgrid.selectAll();
		},
		select: function(row ,toRow){
			this.dgrid.select(row,toRow);
		},
		deselect: function(row,toRow){
			this.dgrid.deselect(row,toRow);
		},
		clearSelection: function(){
			this.dgrid.clearSelection();
		},
		isSelected: function(row){
			this.dgrid.isSelected(row);
		},
		properties: {
			tree: {
				type: "boolean",
				value: true
			},
			dgrid: {
				type: "Object"
			},
			selection: {
				type: "String",
				value: false
			},
			selectionMode: {
				type: "String"
			},
			allowTextSelection: {
				type: "String",
			},
			deselectOnRefresh: {
				type: "boolean",
				value: true
			},
			allowSelectAll: {
				type: "boolean",
				value: false
			},
			value: {
				type: "Array",
				value: [],
				observer: '_valueChanged'
			}

		},
		_valueChanged: function(newValue, oldValue) {
			if (this.dgrid) {

				//this is due to a bug in dgrid refreshing
				createStore.call(this, []);
				this.dgrid.set('collection', this.store);
				this.dgrid.refresh();

				createStore.call(this, newValue);
				this.dgrid.set('collection', this.store);
				this.dgrid.refresh();
			}
		}

	});
});
