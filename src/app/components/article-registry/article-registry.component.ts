import {Component} from '@angular/core';
import {DomSanitizer} from '@angular/platform-browser';
import {FormBuilder} from '@angular/forms';
import {ISbDataTableColumn, ISbDataTableRowClickEvent} from '../common/sb-data-table/data-table.component';
import {TdDataTableService} from '@covalent/core/data-table';
import {TdLoadingService} from '@covalent/core/loading';
import {ArticleEditingDialogComponent} from '../dialog/article-edtiting-dialog/article-editing-dialog.component';
import {DialogMode} from '../dialog/dialog-mode';
import {ArticleService} from '../../services/article/article.service';
import {TableActionConfig, TableActionType, TableComponent} from '../common/table/table.component';
import {Observable} from 'rxjs';
import {DialogService} from "../../services/dialog/dialog.service";

@Component({
  selector: 'app-article-registry',
  templateUrl: '../common/table/table.component.html'
})
export class ArticleRegistryComponent extends TableComponent {

  columns: ISbDataTableColumn[] = [
    {name: 'name', label: 'Название статьи', sortable: true, filter: true, width: 500},
    {name: 'topic', label: 'Тематика', sortable: true, filter: true, width: 200},
    {
      name: 'language', label: 'Язык статьи', sortable: true, width: 100, format: value => {
        if (this.dicts && this.dicts.languages) {
          return this.dicts.languages.find(it => it.id === value).name;
        } else {
          return value;
        }
      }
    },
    {name: 'countView', label: 'Число просмотров', sortable: true, width: 150},
    {name: 'createDate', label: 'Дата создания', sortable: true, filter: true, width: 200}
  ];

  menuItemList = [{
    id: TableActionType.AddRow,
    name: 'Создать статью'
  }
  ];

  sortBy = 'createDate';

  iconColumn = true;

  iconImg = 'edit';

  iconAction = this.editIconAction;

  tableName = 'Реестр статей';

  clickable = true;

  constructor(
    protected dataTableService: TdDataTableService,
    private sanitizer: DomSanitizer,
    private fb: FormBuilder,
    protected loadingService: TdLoadingService,
    private dialogService: DialogService,
    private articleService: ArticleService
  ) {
    super(dataTableService, loadingService);
  }

  getTableData(): Observable<any> {
    return this.articleService.getTable();
  }

  getDictsTableData(): Observable<any> {
    return this.articleService.getDicts();
  }

  menuItemClick(event: MouseEvent, menuItem: TableActionConfig): void {
    if (menuItem) {
      switch (menuItem.id) {
        case TableActionType.AddRow:
          this.create();
          break;
      }
    }
  }

  create(): void {
    this.openArticleDialog({
      mode: DialogMode.CREATE,
      dicts: this.dicts
    });
  }

  editIconAction(row: any, _this: ArticleRegistryComponent): void {
    _this.edit(row.id);
  }

  edit(id: string): void {
    this.openArticleDialog({
      articleId: id,
      mode: DialogMode.EDIT,
      dicts: this.dicts
    });
  }

  openArticleDialog(data: any) {
    this.dialogService.show(ArticleEditingDialogComponent, data,
      '', '', true).afterClosed().subscribe(it => {
      if (it) {
        this.refreshTable();
      }
    });
  }

  public rowDoubleClick(event: ISbDataTableRowClickEvent): void {
    this.openArticleDialog({
      articleId: event.row.id,
      mode: DialogMode.EDIT,
      dicts: this.dicts
    });
  }

}
