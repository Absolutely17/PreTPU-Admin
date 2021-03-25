import {
  AfterContentChecked,
  AfterContentInit,
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ContentChildren,
  ElementRef,
  EventEmitter,
  forwardRef,
  Inject,
  Input,
  OnDestroy,
  OnInit,
  Optional,
  Output,
  QueryList,
  TemplateRef,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import {DOCUMENT} from '@angular/common';
import {DomSanitizer, SafeStyle} from '@angular/platform-browser';
import {NG_VALUE_ACCESSOR} from '@angular/forms';

import {coerceBooleanProperty} from '@angular/cdk/coercion';
import {DOWN_ARROW, ENTER, SPACE, UP_ARROW} from '@angular/cdk/keycodes';

import {Subject, Subscription} from 'rxjs';
import {debounceTime} from 'rxjs/operators';

import {SbDataTableRowComponent} from './data-table-row/data-table-row.component';
import {ISbDataTableSortChangeEvent, SbDataTableColumnComponent} from './data-table-column/data-table-column.component';
import {SbDataTableTemplateDirective} from './directives/data-table-template.directive';

import {IControlValueAccessor, mixinControlValueAccessor} from '@covalent/core/common';
import {SimpleNameObject} from '../../../models/simple-name-object';

export enum ISbDataTableSortingOrder {
  Ascending = 'ASC',
  Descending = 'DESC',
}

export interface ISbDataTableColumnWidth {
  min?: number;
  max?: number;
}

export interface ISbDataTableColumn {
  name: string;
  label: string;
  numeric?: boolean;
  format?: (value: any) => any;
  nested?: boolean;
  sortable?: boolean;
  hidden?: boolean;
  filter?: boolean;
  width?: ISbDataTableColumnWidth | number;
  columnSortOrder?: number;
}

export interface ISbDataTableFilter {
  key?: string;
  name: string;
  label: string;
  type: any;
  value?: any;
  initialValue?: any;
  minValue?: number;
  maxValue?: number;
  step?: number;
  tickInterval?: number;
  variables?: Array<SimpleNameObject>;
}

export interface ISbDataTableSelectEvent {
  row: any;
  selected: boolean;
  index: number;
}

export interface ISbDataTableSelectAllEvent {
  rows: any[];
  selected: boolean;
}

export interface ISbDataTableRowClickEvent {
  row: any;
  index: number;
}

export interface ISbInternalColumnWidth {
  value: number;
  limit: boolean;
  index: number;
  min?: boolean;
  max?: boolean;
}

/**
 * Constant to set the rows offset before and after the viewport
 */
const SB_VIRTUAL_OFFSET = 2;

/**
 * Constant to set default row height if none is provided
 */
const SB_VIRTUAL_DEFAULT_ROW_HEIGHT = 48;

/**
 * Ширина чекбокса
 */
const SB_CHECKBOX_WIDTH = 42;

export class SbDataTableBase {
  constructor(public _changeDetectorRef: ChangeDetectorRef) {
  }
}

/* tslint:disable-next-line */
export const _sbDataTableMixinBase = mixinControlValueAccessor(SbDataTableBase, []);

@Component({
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SbDataTableComponent),
      multi: true,
    },
  ],
  selector: 'sb-data-table',
  styleUrls: ['./data-table.component.scss'],
  templateUrl: './data-table.component.html',
  inputs: ['value'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SbDataTableComponent
  extends _sbDataTableMixinBase
  implements IControlValueAccessor, OnInit, AfterContentInit, AfterContentChecked, AfterViewInit, OnDestroy {
  /** наши кастомные поля */
  private _iconColumn = false; // отрисовывать ли колонку с иконкой
  private _iconImg = ''; // какая именно иконка
  private _iconAction: (row: any, _this: any) => void; // действие которое будет выполнено при нажатии на иконку (необязательно)
  private _callerComponent: any; // Компонента из которой вызыватся таблица
  private _trimLinesMap = {};

  /** геттеры и сеттеры для наших кастомных полей */
  get callerComponent(): any {
    return this._callerComponent;
  }

  @Input('callerComponent')
  set callerComponent(callerComponent: any) {
    this._callerComponent = callerComponent;
  }

  get iconColumn(): boolean {
    return this._iconColumn;
  }

  @Input('iconTooltip') iconTooltip: string;

  @Input('iconColor') iconColor: string;

  @Input('iconColumn')
  set iconColumn(iconColumn: boolean) {
    this._iconColumn = iconColumn;
  }

  get iconImg(): string {
    return this._iconImg;
  }

  @Input('iconImg')
  set iconImg(iconImg: string) {
    this._iconImg = iconImg;
  }

  get iconAction(): (row: any, _this: any) => void {
    return this._iconAction;
  }

  @Input('iconAction')
  set iconAction(iconAction: (row: any, _this: any) => void) {
    this._iconAction = iconAction;
  }

  /** responsive width calculations */
  private _resizeSubs: Subscription;
  private _rowsChangedSubs: Subscription;
  private _hostWidth = 0;

  /** manually resizable columns */
  private _resizableColumns = false;
  private _columnClientX = 0;
  private _columnResizeSubs: Subscription;
  private _resizingColumn: number;
  private _onColumnResize: Subject<number> = new Subject<number>();

  get resizingColumn(): number {
    return this._resizingColumn;
  }

  get hostWidth(): number {
    // if the checkboxes are rendered, we need to remove their width
    // from the total width to calculate properly
    if (this.selectable) {
      return this._hostWidth - SB_CHECKBOX_WIDTH;
    }
    return this._hostWidth;
  }

  private _widths: ISbInternalColumnWidth[] = [];
  private _allCount = 0;
  private _onResize: Subject<void> = new Subject<void>();

  /** column header reposition and viewpoort */
  private _verticalScrollSubs: Subscription;
  private _horizontalScrollSubs: Subscription;
  private _scrollHorizontalOffset = 0;

  private _onHorizontalScroll: Subject<number> = new Subject<number>();
  private _onVerticalScroll: Subject<number> = new Subject<number>();

  // Array of cached row heights to allow dynamic row heights
  private _rowHeightCache: number[] = [];
  // Total pseudo height of all the elements
  private _totalHeight = 0;
  // Total host height for the viewport
  private _hostHeight = 0;
  // Scrolled vertical pixels
  private _scrollVerticalOffset = 0;
  // Style to move the content a certain offset depending on scrolled offset
  private _offsetTransform: SafeStyle;

  // Variables that set from and to which rows will be rendered
  private _fromRow = 0;
  private _toRow = 0;

  /**
   * Returns the offset style with a proper calculation on how much it should move
   * over the y axis of the total height
   */
  get offsetTransform(): SafeStyle {
    return this._offsetTransform;
  }

  /**
   * Returns the assumed total height of the rows
   */
  get totalHeight(): number {
    return this._totalHeight;
  }

  /**
   * Returns the initial row to render in the viewport
   */
  get fromRow(): number {
    return this._fromRow;
  }

  /**
   * Returns the last row to render in the viewport
   */
  get toRow(): number {
    return this._toRow;
  }

  private _valueChangesSubs: Subscription;
  /** internal attributes */
  private _data: any[];
  // data virtually iterated by component
  private _virtualData: any[];
  private _columns: ISbDataTableColumn[];
  private _selectable = false;
  private _clickable = false;
  private _multiple = true;
  private _allSelected = false;
  private _indeterminate = false;
  private _multiCheckerItems: SimpleNameObject[];

  /** sorting */
  private _sortable = false;
  private _sortBy: ISbDataTableColumn;
  private _sortOrder: ISbDataTableSortingOrder = ISbDataTableSortingOrder.Ascending;

  /** filtering */
  private _filters: ISbDataTableFilter[];

  /** shift select */
  private _shiftPreviouslyPressed = false;
  private _lastSelectedIndex = -1;
  private _firstSelectedIndex = -1;
  private _firstCheckboxValue = false;

  /** template fetching support */
  private _templateMap: Map<string, TemplateRef<any>> = new Map<string, TemplateRef<any>>();
  @ContentChildren(SbDataTableTemplateDirective, {descendants: true}) _templates: QueryList<SbDataTableTemplateDirective>;

  @ViewChild('scrollableDiv', {static: true}) _scrollableDiv: ElementRef;

  @ViewChildren('columnElement') _colElements: QueryList<SbDataTableColumnComponent>;

  @ViewChildren(SbDataTableRowComponent) _rows: QueryList<SbDataTableRowComponent>;

  /**
   * Returns scroll position to reposition column headers
   */
  get columnsLeftScroll(): number {
    return this._scrollHorizontalOffset * -1;
  }

  /**
   * Returns true if all values are selected.
   */
  get allSelected(): boolean {
    return this._allSelected;
  }

  /**
   * Returns true if all values are not deselected
   * and at least one is.
   */
  get indeterminate(): boolean {
    return this._indeterminate;
  }

  /**
   * data?: {[key: string]: any}[]
   * Sets the data to be rendered as rows.
   */
  @Input('data')
  set data(data: any[]) {
    this._data = data;
    this._rowHeightCache = [];
    Promise.resolve().then(() => {
      this.refresh();
      // scroll back to the top if the data has changed
      this._scrollableDiv.nativeElement.scrollTop = 0;
    });
  }

  get data(): any[] {
    return this._data;
  }

  get virtualData(): any[] {
    return this._virtualData;
  }

  @Input('multiCheckerItems')
  set multiCheckerItems(multiCheckerItems: SimpleNameObject[]) {
    this._multiCheckerItems = multiCheckerItems;
  }

  get multiCheckerItems(): SimpleNameObject[] {
    return this._multiCheckerItems;
  }

  /**
   * columns?: ISbDataTableColumn[]
   * Sets additional column configuration. [ISbDataTableColumn.name] has to exist in [data] as key.
   * Defaults to [data] keys.
   */
  @Input('columns')
  set columns(cols: ISbDataTableColumn[]) {
    this._columns = cols;
  }

  get columns(): ISbDataTableColumn[] {
    if (this._columns) {
      return this._columns;
    }

    if (this.hasData) {
      this._columns = [];
      // if columns is undefined, use key in [data] rows as name and label for column headers.
      const row: any = this._data[0];
      Object.keys(row).forEach((k: string) => {
        if (!this._columns.find((c: any) => c.name === k)) {
          this._columns.push({name: k, label: k});
        }
      });
      return this._columns;
    }
    return [];
  }

  get filters(): ISbDataTableFilter[] {
    if (this._filters) {
      return this._filters;
    }
    return null
  }

  /**
   * resizableColumns?: boolean
   * Enables manual column resize.
   * Defaults to 'false'
   */
  @Input('resizableColumns')
  set resizableColumns(resizableColumns: boolean) {
    this._resizableColumns = coerceBooleanProperty(resizableColumns);
  }

  get resizableColumns(): boolean {
    return this._resizableColumns;
  }

  /**
   * selectable?: boolean
   * Enables row selection events, hover and selected row states.
   * Defaults to 'false'
   */
  @Input('selectable')
  set selectable(selectable: boolean) {
    this._selectable = coerceBooleanProperty(selectable);
  }

  get selectable(): boolean {
    return this._selectable;
  }

  /**
   * clickable?: boolean
   * Enables row click events, hover.
   * Defaults to 'false'
   */
  @Input('clickable')
  set clickable(clickable: boolean) {
    this._clickable = coerceBooleanProperty(clickable);
  }

  get clickable(): boolean {
    return this._clickable;
  }

  /**
   * multiple?: boolean
   * Enables multiple row selection. [selectable] needs to be enabled.
   * Defaults to 'false'
   */
  @Input('multiple')
  set multiple(multiple: boolean) {
    this._multiple = coerceBooleanProperty(multiple);
  }

  get multiple(): boolean {
    return this._multiple;
  }

  /**
   * sortable?: boolean
   * Enables sorting events, sort icons and active column states.
   * Defaults to 'false'
   */
  @Input('sortable')
  set sortable(sortable: boolean) {
    this._sortable = coerceBooleanProperty(sortable);
  }

  get sortable(): boolean {
    return this._sortable;
  }

  /**
   * sortBy?: string
   * Sets the active sort column. [sortable] needs to be enabled.
   */
  // eslint-disable-next-line accessor-pairs
  @Input('sortBy')
  set sortBy(columnName: string) {
    if (!columnName) {
      return;
    }
    const column: ISbDataTableColumn = this.columns.find((c: any) => c.name === columnName);
    if (!column) {
      throw new Error('[sortBy] must be a valid column name');
    }

    this._sortBy = column;
  }

  get allCount(): number {
    return this._allCount;
  }

  set allCount(value: number) {
    this._allCount = value;
  }

  get sortByColumn(): ISbDataTableColumn {
    return this._sortBy;
  }

  /**
   * sortOrder?: ['ASC' | 'DESC'] or ISbDataTableSortingOrder
   * Sets the sort order of the [sortBy] column. [sortable] needs to be enabled.
   * Defaults to 'ASC' or ISbDataTableSortingOrder.Ascending
   */
  // eslint-disable-next-line accessor-pairs
  @Input('sortOrder')
  set sortOrder(order: 'ASC' | 'DESC') {
    const sortOrder: string = order ? order.toUpperCase() : 'ASC';
    if (sortOrder !== 'DESC' && sortOrder !== 'ASC') {
      throw new Error('[sortOrder] must be empty, ASC or DESC');
    }

    this._sortOrder = sortOrder === 'ASC' ? ISbDataTableSortingOrder.Ascending : ISbDataTableSortingOrder.Descending;
  }

  get sortOrderEnum(): ISbDataTableSortingOrder {
    return this._sortOrder;
  }

  get hasData(): boolean {
    return this._data && this._data.length > 0;
  }

  /**
   * sortChange?: function
   * Event emitted when the column headers are clicked. [sortable] needs to be enabled.
   * Emits an [ISbDataTableSortChangeEvent] implemented object.
   */
  @Output() sortChange: EventEmitter<ISbDataTableSortChangeEvent> = new EventEmitter<ISbDataTableSortChangeEvent>();

  /**
   * rowSelect?: function
   * Event emitted when a row is selected/deselected. [selectable] needs to be enabled.
   * Emits an [ISbDataTableSelectEvent] implemented object.
   */
  @Output() rowSelect: EventEmitter<ISbDataTableSelectEvent> = new EventEmitter<ISbDataTableSelectEvent>();

  /**
   * rowClick?: function
   * Event emitted when a row is clicked.
   * Emits an [ISbDataTableRowClickEvent] implemented object.
   */
  @Output() rowClick: EventEmitter<ISbDataTableRowClickEvent> = new EventEmitter<ISbDataTableRowClickEvent>();

  @Output() rowDoubleClick: EventEmitter<ISbDataTableRowClickEvent> = new EventEmitter<ISbDataTableRowClickEvent>();

  /**
   * selectAll?: function
   * Event emitted when all rows are selected/deselected by the all checkbox. [selectable] needs to be enabled.
   * Emits an [ISbDataTableSelectAllEvent] implemented object.
   */
  @Output() selectAll: EventEmitter<ISbDataTableSelectAllEvent> = new EventEmitter<ISbDataTableSelectAllEvent>();

  constructor(
    @Optional() @Inject(DOCUMENT) private _document: any,
    private _elementRef: ElementRef,
    private _domSanitizer: DomSanitizer,
    _changeDetectorRef: ChangeDetectorRef,
  ) {
    super(_changeDetectorRef);
  }

  /**
   * compareWith?: function(row, model): boolean
   * Allows custom comparison between row and model to see if row is selected or not
   * Default comparation is by reference
   */
  @Input() compareWith: (row: any, model: any) => boolean = (row: any, model: any) => {
    return row.id === model.id;
  };

  /**
   * Initialize observable for resize and scroll events
   */
  ngOnInit(): void {
    // initialize observable for resize calculations
    this._resizeSubs = this._onResize.asObservable().subscribe(() => {
      if (this._rows) {
        this._rows.toArray().forEach((row: SbDataTableRowComponent, index: number) => {
          this._rowHeightCache[this.fromRow + index] = row.height + 1;
        });
      }
      this._calculateWidths();
      this._calculateVirtualRows();
    });

    // initialize observable for column resize calculations
    this._columnResizeSubs = this._onColumnResize
      .asObservable()
      .pipe(debounceTime(0))
      .subscribe((clientX: number) => {
        this._columnClientX = clientX;
        this._calculateWidths();
        this._changeDetectorRef.markForCheck();
      });
    // initialize observable for scroll column header reposition
    this._horizontalScrollSubs = this._onHorizontalScroll.asObservable().subscribe((horizontalScroll: number) => {
      this._scrollHorizontalOffset = horizontalScroll;
      this._changeDetectorRef.markForCheck();
    });
    // initialize observable for virtual scroll rendering
    this._verticalScrollSubs = this._onVerticalScroll.asObservable().subscribe((verticalScroll: number) => {
      this._scrollVerticalOffset = verticalScroll;
      this._calculateVirtualRows();
      this._changeDetectorRef.markForCheck();
    });
    this._valueChangesSubs = this.valueChanges.subscribe(() => {
      this.refresh();
    });
  }

  /**
   * Loads templates and sets them in a map for faster access.
   */
  ngAfterContentInit(): void {
    for (const template of this._templates.toArray()) {
      this._templateMap.set(template.sbDataTableTemplate, template.templateRef);
    }
  }

  /**
   * Checks hosts native elements widths to see if it has changed (resize check)
   */
  ngAfterContentChecked(): void {
    // check if the scroll has been reset when element is hidden
    if (this._scrollVerticalOffset - this._scrollableDiv.nativeElement.scrollTop > 5) {
      // scroll back to the top if element has been reset
      this._onVerticalScroll.next(0);
    }
    if (this._elementRef.nativeElement) {
      const newHostWidth: number = this._elementRef.nativeElement.getBoundingClientRect().width;
      // if the width has changed then we throw a resize event.
      if (this._hostWidth !== newHostWidth) {
        setTimeout(() => {
          this._hostWidth = newHostWidth;
          this._onResize.next();
        }, 0);
      }
    }
    if (this._scrollableDiv.nativeElement) {
      const newHostHeight: number = this._scrollableDiv.nativeElement.getBoundingClientRect().height;
      // if the height of the viewport has changed, then we mark for check
      if (this._hostHeight !== newHostHeight) {
        this._hostHeight = newHostHeight;
        this._calculateVirtualRows();
        this._changeDetectorRef.markForCheck();
      }
    }
  }

  /**
   * Registers to an observable that checks if all rows have been rendered
   * so we can start calculating the widths
   */
  ngAfterViewInit(): void {
    this._rowsChangedSubs = this._rows.changes.pipe(debounceTime(0)).subscribe(() => {
      this._onResize.next();
    });
    this._calculateVirtualRows();
  }

  /**
   * Unsubscribes observables when data table is destroyed
   */
  ngOnDestroy(): void {
    if (this._resizeSubs) {
      this._resizeSubs.unsubscribe();
    }
    if (this._columnResizeSubs) {
      this._columnResizeSubs.unsubscribe();
    }
    if (this._horizontalScrollSubs) {
      this._horizontalScrollSubs.unsubscribe();
    }
    if (this._verticalScrollSubs) {
      this._verticalScrollSubs.unsubscribe();
    }
    if (this._rowsChangedSubs) {
      this._rowsChangedSubs.unsubscribe();
    }
    if (this._valueChangesSubs) {
      this._valueChangesSubs.unsubscribe();
    }
  }

  /**
   * Method that gets executed every time there is a scroll event
   * Calls the scroll observable
   */
  handleScroll(event: Event): void {
    const element: HTMLElement = <HTMLElement>event.target;
    if (element) {
      const horizontalScroll: number = element.scrollLeft;
      if (this._scrollHorizontalOffset !== horizontalScroll) {
        this._onHorizontalScroll.next(horizontalScroll);
      }
      const verticalScroll: number = element.scrollTop;
      if (this._scrollVerticalOffset !== verticalScroll) {
        this._onVerticalScroll.next(verticalScroll);
      }
    }
  }

  /**
   * Returns the width needed for the columns via index
   */
  getColumnWidth(index: number): number {
    if (this._widths[index]) {
      return this._widths[index].value;
    }
    return undefined;
  }

  getCellValue(column: ISbDataTableColumn, value: any, rowIndex: number): string {
    if (column.nested === undefined || column.nested) {
      return this._getNestedValue(column.name, value);
    }
    return value[column.name];
  }


  /**
   * Getter method for template references
   */
  getTemplateRef(name: string): TemplateRef<any> {
    return this._templateMap.get(name);
  }

  /**
   * Clears model (ngModel) of component by removing all values in array.
   */
  clearModel(): void {
    this.value.splice(0, this.value.length);
  }

  /**
   * Refreshes data table and rerenders [data] and [columns]
   */
  refresh(): void {
    this._calculateVirtualRows();
    this._calculateWidths();
    this._calculateCheckboxState();
    this._changeDetectorRef.markForCheck();
    this._trimLinesMap = {};
  }

  /**
   * Selects or clears all rows depending on 'checked' value.
   */
  selectAllMethod(checked: boolean): void {
    const toggledRows: any[] = [];
    if (checked) {
      this._data.forEach((row: any) => {
        // skiping already selected rows
        if (!this.isRowSelected(row)) {
          this.value.push(row);
          // checking which ones are being toggled
          toggledRows.push(row);
        }
      });
      this._allSelected = true;
      this._indeterminate = true;
    } else {
      this._data.forEach((row: any) => {
        // checking which ones are being toggled
        if (this.isRowSelected(row)) {
          toggledRows.push(row);
          const modelRow: any = this.value.filter((val: any) => {
            return this.compareWith(row, val);
          })[0];
          const index: number = this.value.indexOf(modelRow);
          if (index > -1) {
            this.value.splice(index, 1);
          }
        }
      });
      this._allSelected = false;
      this._indeterminate = false;
    }
    this.selectAll.emit({rows: toggledRows, selected: checked});
    this.onChange(this.value);
  }

  /**
   * Checks if row is selected
   */
  isRowSelected(row: any): boolean {
    // compare items by [compareWith] function
    return this.value
      ? this.value.filter((val: any) => {
      return this.compareWith(row, val);
    }).length > 0
      : false;
  }

  /**
   * Selects or clears a row depending on 'checked' value if the row 'isSelectable'
   * handles cntrl clicks and shift clicks for multi-select
   */
  select(row: any, event: Event, currentSelected: number): void {
    if (this.selectable) {
      this.blockEvent(event);
      // Check to see if Shift key is selected and need to select everything in between
      const mouseEvent: MouseEvent = event as MouseEvent;
      if (this.multiple && mouseEvent && mouseEvent.shiftKey && this._lastSelectedIndex > -1) {
        let firstIndex: number = currentSelected;
        let lastIndex: number = this._lastSelectedIndex;
        if (currentSelected > this._lastSelectedIndex) {
          firstIndex = this._lastSelectedIndex;
          lastIndex = currentSelected;
        }
        // if clicking a checkbox behind the initial check, then toggle all selections expect the initial checkbox
        // else the checkboxes clicked are all after the initial one
        if (
          this._firstSelectedIndex >= currentSelected && this._lastSelectedIndex > this._firstSelectedIndex ||
          this._firstSelectedIndex <= currentSelected && this._lastSelectedIndex < this._firstSelectedIndex
        ) {
          for (let i: number = firstIndex; i <= lastIndex; i++) {
            if (this._firstSelectedIndex !== i) {
              this._doSelection(this._data[i], i);
            }
          }
        } else if (this._firstSelectedIndex > currentSelected || this._firstSelectedIndex < currentSelected) {
          // change indexes depending on where the next checkbox is selected (before or after)
          if (this._firstSelectedIndex > currentSelected) {
            lastIndex--;
          } else if (this._firstSelectedIndex < currentSelected) {
            firstIndex++;
          }
          for (let i: number = firstIndex; i <= lastIndex; i++) {
            const rowSelected: boolean = this.isRowSelected(this._data[i]);
            // if row is selected and first checkbox was selected
            // or if row was unselected and first checkbox was unselected
            // we ignore the toggle
            if (this._firstCheckboxValue && !rowSelected || !this._firstCheckboxValue && rowSelected) {
              this._doSelection(this._data[i], i);
            } else if (
              this._shiftPreviouslyPressed &&
              (currentSelected >= this._firstSelectedIndex && currentSelected <= this._lastSelectedIndex ||
                currentSelected <= this._firstSelectedIndex && currentSelected >= this._lastSelectedIndex)
            ) {
              // else if the checkbox selected was in the middle of the last selection and the first selection
              // then we undo the selections
              this._doSelection(this._data[i], i);
            }
          }
        }
        this._shiftPreviouslyPressed = true;
        // if shift wasnt pressed, then we take the element checked as the first row
        // incase the next click uses shift
      } else if (mouseEvent && !mouseEvent.shiftKey) {
        this._firstCheckboxValue = this._doSelection(row, currentSelected);
        this._shiftPreviouslyPressed = false;
        this._firstSelectedIndex = currentSelected;
      }
      this._lastSelectedIndex = currentSelected;
    }
  }

  /**
   * Overrides the onselectstart method of the document so other text on the page
   * doesn't get selected when doing shift selections.
   */
  disableTextSelection(): void {
    if (this._document) {
      this._document.onselectstart = function (): boolean {
        return false;
      };
    }
  }

  /**
   * Resets the original onselectstart method.
   */
  enableTextSelection(): void {
    if (this._document) {
      this._document.onselectstart = undefined;
    }
  }

  /**
   * emits the onRowClickEvent when a row is clicked
   * if clickable is true and selectable is false then select the row
   */
  handleRowClick(row: any, index: number, event: Event): void {
    this.handleRowClickOrDblClick(row, index, event, this.rowClick);
  }

  handleRowDblClick(row: any, index: number, event: Event): void {
    this.handleRowClickOrDblClick(row, index, event, this.rowDoubleClick);
  }

  handleRowClickOrDblClick(row: any, index: number, event: any, emitter: EventEmitter<ISbDataTableRowClickEvent>): void {
    if (this.clickable) {
      // ignoring linting rules here because attribute it actually null or not there
      // can't check for undefined
      const srcElement: any = event.srcElement || event.currentTarget;
      const element: HTMLElement = event.target as HTMLElement;
      /* tslint:disable-next-line */
      if (srcElement.getAttribute('stopRowClick') === null && element.tagName.toLowerCase() !== 'mat-pseudo-checkbox') {
        emitter.emit({
          row: row,
          index: index,
          // @ts-ignore
          rawEvent: event
        });
      }
    }
  }

  /**
   * Method handle for sort click event in column headers.
   */
  handleSort(column: ISbDataTableColumn): void {
    if (this._sortBy === column) {
      this._sortOrder =
        this._sortOrder === ISbDataTableSortingOrder.Ascending
          ? ISbDataTableSortingOrder.Descending
          : ISbDataTableSortingOrder.Ascending;
    } else {
      this._sortBy = column;
      this._sortOrder = ISbDataTableSortingOrder.Ascending;
    }
    this.sortChange.next({name: this._sortBy.name, order: this._sortOrder});
  }

  /**
   * Handle all keyup events when focusing a data table row
   */
  _rowKeyup(event: KeyboardEvent, row: any, index: number): void {
    switch (event.keyCode) {
      case ENTER:
      case SPACE:
        /** if user presses enter or space, the row should be selected */
        if (this.selectable) {
          this._doSelection(this._data[this.fromRow + index], this.fromRow + index);
        }
        break;
      case UP_ARROW:
        /**
         * if users presses the up arrow, we focus the prev row
         * unless its the first row
         */
        if (index > 0) {
          this._rows.toArray()[index - 1].focus();
        }
        this.blockEvent(event);
        if (this.selectable && this.multiple && event.shiftKey && this.fromRow + index >= 0) {
          this._doSelection(this._data[this.fromRow + index], this.fromRow + index);
        }
        break;
      case DOWN_ARROW:
        /**
         * if users presses the down arrow, we focus the next row
         * unless its the last row
         */
        if (index < this._rows.toArray().length - 1) {
          this._rows.toArray()[index + 1].focus();
        }
        this.blockEvent(event);
        if (this.selectable && this.multiple && event.shiftKey && this.fromRow + index < this._data.length) {
          this._doSelection(this._data[this.fromRow + index], this.fromRow + index);
        }
        break;
      default:
      // default
    }
  }

  /**
   * Sets column index of the dragged column and initial clientX of column
   */
  _handleStartColumnDrag(index: number, event: MouseEvent): void {
    this._columnClientX = event.clientX;
    this._resizingColumn = index;
  }

  /**
   * Calculates new width depending on new clientX of dragger column
   */
  _handleColumnDrag(event: MouseEvent | DragEvent): void {
    // check if there was been a separator clicked for resize
    if (this._resizingColumn !== undefined && event.clientX > 0) {
      const xPosition: number = event.clientX;
      // checks if the separator is being moved to try and resize the column, else dont do anything
      if (xPosition > 0 && this._columnClientX > 0 && xPosition - this._columnClientX !== 0) {
        // calculate the new width depending if making the column bigger or smaller
        let proposedManualWidth: number = this._widths[this._resizingColumn].value + (xPosition - this._columnClientX);
        // if the proposed new width is less than the projected min width of the column, use projected min width
        if (proposedManualWidth < this._colElements.toArray()[this._resizingColumn].projectedWidth) {
          proposedManualWidth = this._colElements.toArray()[this._resizingColumn].projectedWidth;
        }
        this.columns[this._resizingColumn].width = proposedManualWidth;
        // update new x position for the resized column
        this._onColumnResize.next(xPosition);
      }
    }
  }

  /**
   * Ends dragged flags
   */
  _handleEndColumnDrag(): void {
    this._columnClientX = undefined;
    this._resizingColumn = undefined;
  }

  /**
   * Method to prevent the default events
   */
  blockEvent(event: Event): void {
    event.preventDefault();
  }

  private _getNestedValue(name: string, value: any): string {
    if (!(value instanceof Object) || !name) {
      return value;
    }
    if (name.indexOf('.') > -1) {
      const splitName: string[] = name.split(/\.(.+)/, 2);
      return this._getNestedValue(splitName[1], value[splitName[0]]);
    } else {
      return value[name];
    }
  }

  doInitSelection(defaultSelected: string[]): void {
    this._data.forEach((it, index) => {
      if (defaultSelected && defaultSelected.find(item => item === it.id)) {
        this._doSelection(it, index);
      }
    });
  }

  /**
   * Does the actual Row Selection
   */
  private _doSelection(row: any, rowIndex: number): boolean {
    const wasSelected: boolean = this.isRowSelected(row);
    if (wasSelected) {
      // compare items by [compareWith] function
      row = this.value.filter((val: any) => {
        return this.compareWith(row, val);
      })[0];
      const index: number = this.value.indexOf(row);
      if (index > -1) {
        this.value.splice(index, 1);
      }
    } else {
      if (!this._multiple) {
        this.clearModel();
      }
      this.value.push(row);
    }
    this._calculateCheckboxState();
    this.rowSelect.emit({row, index: rowIndex, selected: !wasSelected});
    this.onChange(this.value);
    return !wasSelected;
  }

  /**
   * Calculate all the state of all checkboxes
   */
  private _calculateCheckboxState(): void {
    if (this._data) {
      this._allSelected = typeof this._data.find((d: any) => !this.isRowSelected(d)) === 'undefined';
      this._indeterminate = false;
      for (const row of this._data) {
        if (!this.isRowSelected(row)) {
          continue;
        }
        this._indeterminate = true;
        break;
      }
    }
  }

  /**
   * Calculates the widths for columns and cells depending on content
   */
  private _calculateWidths(): void {
    if (this._colElements && this._colElements.length) {
      this._widths = [];
      this._colElements.forEach((col: SbDataTableColumnComponent, index: number) => {
        this._adjustColumnWidth(index, this._calculateWidth());
      });
      this._adjustColumnWidhts();
      this._changeDetectorRef.markForCheck();
    }
  }

  /**
   * Adjusts columns after calculation to see if they need to be recalculated.
   */
  private _adjustColumnWidhts(): void {
    let fixedTotalWidth = 0;
    // get the number of total columns that have flexible widths (not fixed or hidden)
    const flexibleWidths: number = this._widths.filter((width: ISbInternalColumnWidth, index: number) => {
      if (this.columns[index].hidden) {
        return false;
      }
      if (width.limit || width.max || width.min) {
        fixedTotalWidth += width.value;
      }
      return !width.limit && !width.max && !width.min;
    }).length;
    // calculate how much pixes are left that could be spread across
    // the flexible columns
    let recalculateHostWidth = 0;
    if (fixedTotalWidth < this.hostWidth) {
      recalculateHostWidth = this.hostWidth - fixedTotalWidth;
    }
    // if we have flexible columns and pixels to spare on them
    // we try and spread the pixels across them
    if (flexibleWidths && recalculateHostWidth) {
      const newValue: number = Math.floor(recalculateHostWidth / flexibleWidths);
      let adjustedNumber = 0;
      // adjust the column widths with the spread pixels
      this._widths.forEach((colWidth: ISbInternalColumnWidth) => {
        if (
          this._widths[colWidth.index].max && this._widths[colWidth.index].value > newValue ||
          this._widths[colWidth.index].min && this._widths[colWidth.index].value < newValue ||
          !this._widths[colWidth.index].limit
        ) {
          this._adjustColumnWidth(colWidth.index, newValue);
          adjustedNumber++;
        }
      });
      // if there are still columns that need to be recalculated, we start over
      const newFlexibleWidths: number = this._widths.filter((width: ISbInternalColumnWidth) => {
        return !width.limit && !width.max;
      }).length;
      if (newFlexibleWidths !== adjustedNumber && newFlexibleWidths !== flexibleWidths) {
        this._adjustColumnWidhts();
      }
    }
  }

  /**
   * Adjusts a single column to see if it can be recalculated
   */
  private _adjustColumnWidth(index: number, value: number): void {
    this._widths[index] = {
      value,
      index,
      limit: false,
      min: false,
      max: false,
    };
    // flag to see if we need to skip the min width projection
    // depending if a width or min width has been provided
    let skipMinWidthProjection = false;
    if (this.columns[index]) {
      // if the provided width has min/max, then we check to see if we need to set it
      if (typeof this.columns[index].width === 'object') {
        const widthOpts: ISbDataTableColumnWidth = <ISbDataTableColumnWidth> this.columns[index].width;
        // if the column width is less than the configured min, we override it
        skipMinWidthProjection = widthOpts && !!widthOpts.min;
        if (widthOpts && widthOpts.min >= this._widths[index].value) {
          this._widths[index].value = widthOpts.min;
          this._widths[index].min = true;
          // if the column width is more than the configured max, we override it
        } else if (widthOpts && widthOpts.max <= this._widths[index].value) {
          this._widths[index].value = widthOpts.max;
          this._widths[index].max = true;
        }
        // if it has a fixed width, then we just set it
      } else if (typeof this.columns[index].width === 'number') {
        this._widths[index].value = <number> this.columns[index].width;
        skipMinWidthProjection = this._widths[index].limit = true;
      }
    }
    // if there wasn't any width or min width provided, we set a min to what the column width min should be
    if (!skipMinWidthProjection && this._widths[index].value < this._colElements.toArray()[index].projectedWidth) {
      this._widths[index].value = this._colElements.toArray()[index].projectedWidth;
      this._widths[index].min = true;
      this._widths[index].limit = false;
    }
  }

  /**
   * Generic method to calculate column width
   */
  private _calculateWidth(): number {
    const renderedColumns: ISbDataTableColumn[] = this.columns.filter((col: ISbDataTableColumn) => !col.hidden);
    return Math.floor(this.hostWidth / renderedColumns.length);
  }

  /**
   * Method to calculate the rows to be rendered in the viewport
   */
  private _calculateVirtualRows(): void {
    let scrolledRows = 0;
    if (this._data) {
      this._totalHeight = 0;
      let rowHeightSum = 0;
      // loop through all rows to see if we have their height cached
      // and sum them all to calculate the total height
      this._data.forEach((d: any, i: number) => {
        // iterate through all rows at first and assume all
        // rows are the same height as the first one
        if (!this._rowHeightCache[i]) {
          this._rowHeightCache[i] = this._rowHeightCache[0] || SB_VIRTUAL_DEFAULT_ROW_HEIGHT;
        }
        rowHeightSum += this._rowHeightCache[i];
        // check how many rows have been scrolled
        if (this._scrollVerticalOffset - rowHeightSum > 0) {
          scrolledRows++;
        }
      });
      this._totalHeight = rowHeightSum;
      // set the initial row to be rendered taking into account the row offset
      const fromRow: number = scrolledRows - SB_VIRTUAL_OFFSET;
      this._fromRow = fromRow > 0 ? fromRow : 0;

      let hostHeight: number = this._hostHeight;
      let index = 0;
      // calculate how many rows can fit in the viewport
      while (hostHeight > 0) {
        hostHeight -= this._rowHeightCache[this.fromRow + index];
        index++;
      }
      // set the last row to be rendered taking into account the row offset
      const range: number = index - 1 + SB_VIRTUAL_OFFSET * 2;
      let toRow: number = range + this.fromRow;
      // if last row is greater than the total length, then we use the total length
      if (isFinite(toRow) && toRow > this._data.length) {
        toRow = this._data.length;
      } else if (!isFinite(toRow)) {
        toRow = SB_VIRTUAL_OFFSET;
      }
      this._toRow = toRow;
    } else {
      this._totalHeight = 0;
      this._fromRow = 0;
      this._toRow = 0;
    }

    let offset = 0;
    // calculate the proper offset depending on how many rows have been scrolled
    if (scrolledRows > SB_VIRTUAL_OFFSET) {
      for (let index = 0; index < this.fromRow; index++) {
        offset += this._rowHeightCache[index];
      }
    }

    this._offsetTransform = this._domSanitizer.bypassSecurityTrustStyle(
      'translateY(' + (offset - this.totalHeight) + 'px)',
    );
    if (this._data) {
      this._virtualData = this.data.slice(this.fromRow, this.toRow);
    }
    // mark for check at the end of the queue so we are sure
    // that the changes will be marked
    Promise.resolve().then(() => {
      this._changeDetectorRef.markForCheck();
    });
  }

  iconColumnClick(row: any): void {
    if (this.iconAction) {
      this.iconAction(row, this.callerComponent);
    }
  }


}
