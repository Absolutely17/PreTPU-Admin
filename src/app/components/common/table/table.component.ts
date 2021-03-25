import {TdDataTableService, TdDataTableSortingOrder} from '@covalent/core/data-table';
import {Input, OnInit, ViewChild} from '@angular/core';
import {IPageChangeEvent, TdPagingBarComponent} from '@covalent/core/paging';
import {TdLoadingService} from '@covalent/core/loading';
import {
  ISbDataTableColumn,
  ISbDataTableRowClickEvent,
  ISbDataTableSortingOrder,
  SbDataTableComponent
} from '../sb-data-table/data-table.component';
import {ISbDataTableSortChangeEvent} from '../sb-data-table/data-table-column/data-table-column.component';
import {Observable} from 'rxjs';
import * as moment from "moment";

export enum TableActionType {
  AddRow = 'AddRow'
}

export interface TableActionConfig {
  id: TableActionType;
  name: string;
}

export interface AdditionalMenuItem {
  name: string;
  func: any;
  icon: string;
  tooltip?: string;
}

export abstract class TableComponent implements OnInit {

  @ViewChild(TdPagingBarComponent, {static: true}) pagingBar: TdPagingBarComponent;

  @ViewChild(SbDataTableComponent) dataTable: SbDataTableComponent;

  /**
   * Информация о колонках (Обязательно для переопределения!)
   */
  columns: ISbDataTableColumn[] = [];

  data: any[];

  dicts: any;

  _selectable: boolean;

  _multiple: boolean;

  tableName: string;

  filterTerm: string;

  @Input('selectable')
  set selectable(selectDefault: boolean) {
    this._selectable = selectDefault;
  }

  get selectable() {
    return this._selectable;
  }

  @Input('multiple')
  set multiple(multiple: boolean) {
    this._multiple = multiple;
  }

  get multiple() {
    return this._multiple;
  }

  // Старый метод выделения уже имеющихся строк. Пока пусть останется
  @Input('defaultSelected')
  defaultSelected: string[];

  filteredData: any[];
  filteredTotal: number;

  @Input() selectedRows: any[];

  @Input() loaderName = 'tableLoading';

  fromRow = 1;
  currentPage = 1;
  pageSize = 25;

  /**
   * Переопределить
   */
  sortBy = 'name';

  sortOrder: ISbDataTableSortingOrder = ISbDataTableSortingOrder.Descending;

  /**
   * Список функций
   */
  menuItemList: TableActionConfig[] = [];

  additionalMenuItems: AdditionalMenuItem[];

  _iconColumn: boolean;

  clickable: boolean;

  @Input('iconColumn')
  set iconColumn(showIcon: boolean) {
    this._iconColumn = showIcon;
  }

  get iconColumn() {
    return this._iconColumn;
  }

  iconImg: string;

  /**
   * Действие которое выполнится при нажатии на кнопку
   */
  iconAction: (row: any, _this: TableComponent) => void;

  iconTooltip: string;

  iconColor: string;

  @Input('isDialogView') isDialogView: boolean;

  constructor(
    protected dataTableService: TdDataTableService,
    protected loadingService: TdLoadingService
  ) {
  }

  /**
   * Получения табличных данных (обязательно переопределить)
   */
  abstract getTableData(): Observable<any>;

  /**
   * Получение дополнительных данных (переопределить если нужно)
   */
  abstract getDictsTableData(): Observable<any>;

  ngOnInit(): void {
    this.loadingService.register(this.loaderName);
    this.initTableData();
  }

  initTableData() {
    const dictsObservable = this.getDictsTableData();
    if (dictsObservable) {
      dictsObservable.subscribe(it => {
        this.dicts = it;
        this.refreshTable(true);
      });
    } else {
      this.refreshTable(true);
    }
  }

  sort(sortEvent: ISbDataTableSortChangeEvent): void {
    this.sortBy = sortEvent.name;
    this.sortOrder = sortEvent.order;
    this.refreshTable();
  }

  page(pagingEvent: IPageChangeEvent): void {
    this.fromRow = pagingEvent.fromRow;
    this.currentPage = pagingEvent.page;
    this.pageSize = pagingEvent.pageSize;
    this.refreshTable();
  }

  refreshTable(initRefresh: boolean = false): void {
    if (!initRefresh) {
      this.loadingService.register(this.loaderName);
    }
    this.getTableData().subscribe(it => {
      if (it) {
        let newData: any[] = this.customizeTableRows(it);
        this.filteredTotal = newData.length;
        const excludedColumns: string[] = this.columns
          .filter((column: ISbDataTableColumn) => {
            return (
              (column.filter === undefined && column.hidden === true) ||
              (column.filter !== undefined && column.filter === false)
            );
          })
          .map((column: ISbDataTableColumn) => {
            return column.name;
          });
        newData = this.dataTableService.filterData(newData, this.filterTerm, true, excludedColumns);
        // @ts-ignore
        newData = this.sortData(newData, this.sortBy, this.sortOrder);
        newData = this.dataTableService.pageData(newData, this.fromRow, this.currentPage * this.pageSize);
        this.filteredData = newData;
        this.loadingService.resolve(this.loaderName);
      }
    });
  }

  // Сортируем данные. Вынес из сервиса дефолтного, дабы переопределить функцию сортировки
  sortData(data: any[], sortBy: string, sortOrder: TdDataTableSortingOrder = TdDataTableSortingOrder.Ascending): any[] {
    if (sortBy) {
      data = Array.from(data);
      data.sort((a: any, b: any) => {
        const compA: any = a[sortBy];
        const compB: any = b[sortBy];
        let direction: number = 0;
        const momentCompA = moment(compA, 'HH:mm DD.MM.YYYY', true);
        const momentCompB = moment(compB, 'HH:mm DD.MM.YYYY', true);
        if (this.selectedRows && (this.selectedRows.find((row) => row.id === a.id) || this.selectedRows.find((row) => row.id === b.id))) {
          if (this.selectedRows.find((row) => row.id === a.id) && !this.selectedRows.find((row) => row.id === b.id)) {
            direction = 1;
          } else if (!this.selectedRows.find((row) => row.id === a.id) && this.selectedRows.find((row) => row.id === b.id)) {
            direction = -1;
          }
        } else if (momentCompA.isValid() || momentCompB.isValid()) {
          if (momentCompB.isValid() && !momentCompA.isValid()) {
            direction = -1;
          } else if (!momentCompB.isValid() && momentCompA.isValid()) {
            direction = 1;
          } else {
            // @ts-ignore
            direction = momentCompA.toDate() - momentCompB.toDate();
          }
        } else if (!Number.isNaN(Number.parseFloat(compA)) && !Number.isNaN(Number.parseFloat(compB))) {
          direction = Number.parseFloat(compA) - Number.parseFloat(compB);
        } else {
          if (!compA && compB) {
            direction = -1;
          } else if (!compB && compA) {
            direction = 1
          } else if (compA < compB) {
            direction = -1;
          } else if (compA > compB) {
            direction = 1;
          }
        }
        return direction * (sortOrder === TdDataTableSortingOrder.Descending ? -1 : 1);
      });
    }
    return data;
  }

  /**
   * Обработка нажатия кнопки. Переопределить если добавляются пункты меню
   */
  menuItemClick(event: MouseEvent, menuItem: TableActionConfig): void {
    return;
  }

  filter(filterTerm: string) {
    this.filterTerm = filterTerm;
    this.pagingBar.navigateToPage(1);
    this.refreshTable();
  }

  /**
   * Выставляет спицифические параметры для строк, которые пришли с сервера.
   */
  protected customizeTableRows(tableRows: any[]): any[] {
    return tableRows;
  }

  public rowDoubleClick(event: ISbDataTableRowClickEvent): void {
  }

}
